"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/queries/adminOrders";
import { RESTOCKING_STATUSES } from "@/lib/orders/orderStatus";
import { revalidateCatalog } from "@/lib/queries/catalogCache";
import { createManualOrder } from "@/lib/orders/createManualOrder";
import { updateOrderLines } from "@/lib/orders/updateOrderLines";
import { isManualOrderSource } from "@/lib/orders/orderSource";
import type { LineRequest } from "@/lib/orders/resolveLines";
import type { CreateOrderFieldError } from "@/lib/orders/types";
import {
  searchProductsForOrder,
  type ProductSearchResult,
} from "@/lib/queries/adminProductSearch";
import {
  buildOrderDraft,
  parseOrderJson,
  type ImportIssue,
  type ImportedOrderDraft,
} from "@/lib/orders/importOrder";

export type OrderActionState = { error: string | null };

export async function updateOrderStatus(
  _prevState: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };

  const orderId = Number(formData.get("orderId"));
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!orderId || !ORDER_STATUSES.includes(status as OrderStatus)) {
    return { error: "بيانات غير صالحة." };
  }

  if (RESTOCKING_STATUSES.includes(status as OrderStatus)) {
    return restockOrderInternal(orderId, admin.email, note, status as "cancelled" | "returned");
  }

  await sql.begin(async (trx) => {
    await trx`update public.orders set status = ${status} where id = ${orderId}`;
    await trx`
      insert into public.order_status_history (order_id, status, note, changed_by)
      values (${orderId}, ${status}, ${note}, ${admin.email})
    `;
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return { error: null };
}

// مصاريف التوصيل قابلة للتعديل يدوياً من الإدارة (تُحدَّد بعد تجهيز الطلب
// الفعلي)، والمجموع النهائي (المبلغ المطلوب عند الاستلام) يُعاد حسابه فوراً
// = مجموع المنتجات + مصاريف التوصيل.
export async function updateDeliveryFee(
  _prevState: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  // مصاريف التوصيل حقل مالي — مقصور على Owner/Admin، ليس ضمن صلاحيات Staff.
  if (!isOwnerAdmin(admin)) {
    return { error: "تعديل مصاريف التوصيل مقصور على صاحب الحساب (Admin)." };
  }

  const orderId = Number(formData.get("orderId"));
  const feeRaw = String(formData.get("deliveryFee") ?? "").trim();
  const fee = Number(feeRaw);

  if (!orderId || feeRaw === "" || !Number.isFinite(fee) || fee < 0) {
    return { error: "قيمة مصاريف التوصيل غير صالحة." };
  }

  await sql`
    update public.orders
    set delivery_fee = ${fee}, final_total = items_subtotal + ${fee}
    where id = ${orderId}
  `;

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { error: null };
}

export async function addOrderNote(
  _prevState: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };

  const orderId = Number(formData.get("orderId"));
  const note = String(formData.get("note") ?? "").trim();
  if (!orderId || !note) return { error: "الملاحظة فارغة." };

  const [current] = await sql<{ status: string }[]>`
    select status from public.orders where id = ${orderId}
  `;
  if (!current) return { error: "الطلب غير موجود." };

  await sql`
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (${orderId}, ${current.status}, ${note}, ${admin.email})
  `;

  revalidatePath(`/admin/orders/${orderId}`);
  return { error: null };
}

export async function cancelOrderAction(
  _prevState: OrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };

  const orderId = Number(formData.get("orderId"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!orderId) return { error: "بيانات غير صالحة." };

  return restockOrderInternal(orderId, admin.email, note, "cancelled");
}

const RESTOCK_MOVEMENT_REASON: Record<"cancelled" | "returned", string> = {
  cancelled: "order_cancelled",
  returned: "order_returned",
};

const RESTOCK_DEFAULT_NOTE: Record<"cancelled" | "returned", string> = {
  cancelled: "تم إلغاء الطلب وإرجاع المخزون",
  returned: "تم تسجيل الطلب كراجع وإرجاع المخزون",
};

// إلغاء الطلب أو تسجيله كراجع (returned): نفس المنطق بالضبط لكلتا الحالتين
// — يُرجع المخزون المحجوز عند إنشاء الطلب (سطراً بسطر، مع تسجيل حركة مخزون
// معاكسة لكل سطر). الحماية من استرجاع مزدوج للمخزون تمنع الانتقال بين
// الحالتين المُرجِعتين للمخزون في أي اتجاه (ملغى→راجع أو راجع→ملغى أو نفس
// الحالة مرتين) — فحص الحالة الحالية داخل نفس Transaction (مع قفل الصف عبر
// for update) قبل أي تحديث يمنع أي سباق (race condition) أيضاً.
async function restockOrderInternal(
  orderId: number,
  adminEmail: string,
  note: string | null,
  targetStatus: "cancelled" | "returned"
): Promise<OrderActionState> {
  try {
    await sql.begin(async (trx) => {
      const [order] = await trx<{ status: string }[]>`
        select status from public.orders where id = ${orderId} for update
      `;
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (RESTOCKING_STATUSES.includes(order.status as OrderStatus)) {
        throw new Error("ALREADY_RESTOCKED");
      }

      const items = await trx<
        { product_id: number | null; variant_id: number | null; quantity: number }[]
      >`
        select product_id, variant_id, quantity from public.order_items where order_id = ${orderId}
      `;

      for (const item of items) {
        if (item.variant_id) {
          await trx`
            update public.product_variants set stock_quantity = stock_quantity + ${item.quantity}
            where id = ${item.variant_id}
          `;
        } else if (item.product_id) {
          await trx`
            update public.products set stock_quantity = stock_quantity + ${item.quantity}
            where id = ${item.product_id}
          `;
        }

        await trx`
          insert into public.stock_movements (
            product_id, variant_id, order_id, quantity_delta, reason
          ) values (
            ${item.product_id}, ${item.variant_id}, ${orderId}, ${item.quantity},
            ${RESTOCK_MOVEMENT_REASON[targetStatus]}
          )
        `;
      }

      await trx`update public.orders set status = ${targetStatus} where id = ${orderId}`;
      await trx`
        insert into public.order_status_history (order_id, status, note, changed_by)
        values (
          ${orderId}, ${targetStatus}, ${note ?? RESTOCK_DEFAULT_NOTE[targetStatus]}, ${adminEmail}
        )
      `;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_RESTOCKED") {
      return {
        error:
          targetStatus === "cancelled"
            ? "هذا الطلب مُلغى أو راجع مسبقاً — لا يمكن إلغاؤه مرة أخرى."
            : "هذا الطلب مُلغى أو راجع مسبقاً — لا يمكن تسجيله كراجع مرة أخرى.",
      };
    }
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      return { error: "الطلب غير موجود." };
    }
    console.error("restockOrderInternal: خطأ غير متوقع", error);
    return { error: "تعذّر تنفيذ الإجراء حالياً بسبب مشكلة تقنية." };
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  // الإلغاء/الإرجاع يُعيد الكميات إلى المخزون فعلياً، فيتغيّر ما يراه الزبون
  // (منتج نفد يعود متوفراً). بدون هذا يبقى معروضاً كنافد حتى تنتهي المهلة
  // الاحتياطية.
  revalidateCatalog();
  return { error: null };
}

export type DeleteOrderResult =
  | { error: null; orderNumber: string }
  | { error: string };

/**
 * حذف طلب نهائياً من لوحة الإدارة — مقصور على Owner/Admin.
 *
 * لماذا حذف واحد يكفي: فحصنا المفاتيح الأجنبية الفعلية على قاعدتَي Preview
 * والإنتاج (متطابقتان تماماً)، والسلوك معرَّف أصلاً في المخطَّط:
 *   order_items.order_id          → ON DELETE CASCADE   (تُحذف معه)
 *   order_status_history.order_id → ON DELETE CASCADE   (يُحذف معه)
 *   stock_movements.order_id      → ON DELETE SET NULL  (يبقى، ويفقد الربط)
 * فلا نكتب حذفاً يدوياً بالترتيب — ذلك يكرّر منطقاً تضمنه القاعدة أصلاً،
 * وينكسر بصمت لو أُضيف جدول مرتبط جديد لاحقاً. ولا حاجة لأي migration.
 *
 * ⚠️ ملاحظة عمل مهمة: حركات المخزون تبقى محفوظة عمداً (SET NULL) لأنها سجل
 * جرد، لكن **الحذف لا يُرجِع الكمية إلى المخزون**. إرجاع الكمية يقع فقط عند
 * "إلغاء" أو "إرجاع" الطلب (restockOrderInternal أعلاه). فإن كان المطلوب
 * استرجاع المخزون، يُلغى الطلب أولاً ثم يُحذف.
 *
 * المعاملة هنا ليست تجميلاً: نقفل الصف (for update) ونتحقّق من وجوده داخل
 * نفس المعاملة قبل الحذف، فإما أن يتم كل شيء أو لا شيء — لا حذف جزئي مهما
 * تزامنت الطلبات.
 */
export async function deleteOrder(orderId: number): Promise<DeleteOrderResult> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) {
    return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };
  }
  if (!Number.isInteger(orderId) || orderId < 1) {
    return { error: "رقم الطلب غير صالح." };
  }

  let orderNumber: string;
  try {
    orderNumber = await sql.begin(async (trx) => {
      const [order] = await trx<{ order_number: string }[]>`
        select order_number from public.orders where id = ${orderId} for update
      `;
      if (!order) throw new Error("ORDER_NOT_FOUND");

      await trx`delete from public.orders where id = ${orderId}`;
      return order.order_number;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      return { error: "الطلب غير موجود (ربما حُذف مسبقاً)." };
    }
    console.error("deleteOrder: خطأ غير متوقع", error);
    return { error: "تعذّر حذف الطلب حالياً بسبب مشكلة تقنية. لم يُحذف أي شيء." };
  }

  // مسارات الإدارة فقط — لا علاقة للطلبات بذاكرة الكتالوج، فلا نمسّها.
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return { error: null, orderNumber };
}

// ───────────────────── الطلبات اليدوية وتعديل الطلبات ─────────────────────

export type OrderEditState = { error: string | null; fieldErrors?: CreateOrderFieldError[] };

/**
 * حارس واحد لكل ما يمسّ المال أو المخزون.
 *
 * Staff يرى الطلبات ويحرّك حالاتها، لكنه لا يُنشئ بيعاً ولا يغيّر ثمناً ولا
 * كميةً — تلك صلاحية Owner/Admin وحدها، كما هي مصاريف التوصيل والتقارير
 * أصلاً. الفحص هنا في الخادم لا في الواجهة: إخفاء زرّ ليس حماية.
 */
async function requireOwner(): Promise<{ email: string } | { error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) {
    return { error: "إنشاء الطلبات وتعديل محتواها مقصور على صاحب الحساب (Admin)." };
  }
  return { email: admin.email };
}

/** يقرأ سطور المنتجات من الحقول المتكرّرة في النموذج. */
function readLines(formData: FormData): LineRequest[] {
  const productIds = formData.getAll("productId");
  const quantities = formData.getAll("quantity");
  const prices = formData.getAll("unitPrice");

  const lines: LineRequest[] = [];
  for (let i = 0; i < productIds.length; i += 1) {
    const productId = Number(productIds[i]);
    const quantity = Number(quantities[i]);
    if (!Number.isInteger(productId) || productId <= 0) continue;
    if (!Number.isInteger(quantity) || quantity <= 0) continue;

    const rawPrice = String(prices[i] ?? "").trim();
    lines.push({
      productId,
      variantId: null,
      quantity,
      unitPriceOverride: rawPrice === "" ? null : Number(rawPrice),
    });
  }
  return lines;
}

export async function createManualOrderAction(
  _prevState: OrderEditState,
  formData: FormData
): Promise<OrderEditState> {
  const auth = await requireOwner();
  if ("error" in auth) return { error: auth.error };

  const source = String(formData.get("source") ?? "");
  if (!isManualOrderSource(source)) return { error: "اختر مصدر الطلب." };

  const feeRaw = String(formData.get("deliveryFee") ?? "").trim();
  const deliveryFee = feeRaw === "" ? 0 : Number(feeRaw);

  const result = await createManualOrder({
    customer: {
      fullName: String(formData.get("fullName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      city: String(formData.get("city") ?? ""),
      address: String(formData.get("address") ?? ""),
      notes: String(formData.get("notes") ?? "") || null,
    },
    source,
    deliveryFee,
    createdByEmail: auth.email,
    items: readLines(formData),
    acknowledgeBelowCost: formData.get("acknowledgeBelowCost") === "on",
  });

  if (!result.ok) {
    return { error: result.errors[0]?.message ?? "تعذّر حفظ الطلب.", fieldErrors: result.errors };
  }

  // المخزون تغيّر فعلاً، فصفحات الكتالوج العامة يجب أن تعكسه.
  revalidateCatalog();
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  redirect(`/admin/orders/${result.orderId}`);
}

export async function updateOrderLinesAction(
  _prevState: OrderEditState,
  formData: FormData
): Promise<OrderEditState> {
  const auth = await requireOwner();
  if ("error" in auth) return { error: auth.error };

  const orderId = Number(formData.get("orderId"));
  if (!Number.isInteger(orderId) || orderId <= 0) return { error: "الطلب غير صالح." };

  const feeRaw = String(formData.get("deliveryFee") ?? "").trim();

  const result = await updateOrderLines({
    orderId,
    items: readLines(formData),
    deliveryFee: feeRaw === "" ? null : Number(feeRaw),
    changedByEmail: auth.email,
    acknowledgeBelowCost: formData.get("acknowledgeBelowCost") === "on",
  });

  if (!result.ok) {
    return { error: result.errors[0]?.message ?? "تعذّر حفظ التعديل.", fieldErrors: result.errors };
  }

  revalidateCatalog();
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin/reports");
  return { error: null };
}

/**
 * بحث المنتجات لنموذج الطلب اليدوي. خلف نفس بوابة Owner/Admin لأن نتيجته
 * تحمل ثمن الشراء السرّي.
 */
export async function searchProductsAction(
  term: string
): Promise<{ ok: true; results: ProductSearchResult[] } | { ok: false; error: string }> {
  const auth = await requireOwner();
  if ("error" in auth) return { ok: false, error: auth.error };
  return { ok: true, results: await searchProductsForOrder(term) };
}

/**
 * قراءة بون واتساب وتحويله إلى مسودّة معروضة. **لا تُنشئ طلباً ولا تلمس
 * المخزون** — كل ما تفعله قراءة ومطابقة. الإنشاء يبقى في
 * createManualOrderAction وحده، بعد أن يراجع الإنسان ويضغط التأكيد.
 *
 * خلف نفس بوابة Owner/Admin كبقية هذه الإجراءات: النتيجة تحمل ثمن الشراء.
 */
export async function importOrderDraftAction(
  rawJson: string
): Promise<
  | { ok: true; draft: ImportedOrderDraft; warnings: ImportIssue[] }
  | { ok: false; errors: ImportIssue[] }
> {
  const auth = await requireOwner();
  if ("error" in auth) return { ok: false, errors: [{ field: "auth", message: auth.error }] };

  const parsed = parseOrderJson(rawJson);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  return buildOrderDraft(parsed.value);
}
