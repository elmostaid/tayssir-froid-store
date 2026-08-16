"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/queries/adminOrders";
import { RESTOCKING_STATUSES } from "@/lib/orders/orderStatus";

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

      // كان كل سطر (item) يُنفَّذ بـUPDATE+INSERT منفصلَين ومُنتظَرين بالتتالي
      // (for...of معه await) — N سطر = 2×N رحلة ذهاب-إياب متتالية، كل واحدة
      // تُبقي نفس اتصال sql.begin() الوحيد مشغولاً طوال مدتها. هذا يُطيل مدة
      // إمساك هذا الاتصال بشكل يتناسب خطياً مع عدد أسطر الطلب، مما يزيد فرصة
      // نفاد اتصالات الـpooler (Supabase Transaction Pooler) لاستعلامات أخرى
      // غير مرتبطة أثناء انتظارها دورها. الآن كل تحديثات المخزون تُدفَع دفعة
      // واحدة (UPDATE واحد لكل نوع + INSERT واحد للجميع)، فمدة إمساك الاتصال
      // لا تعتمد على عدد الأسطر داخل نفس الطلب.
      const variantItems = items.filter(
        (item): item is typeof item & { variant_id: number } => item.variant_id != null
      );
      const productItems = items.filter(
        (item): item is typeof item & { product_id: number } =>
          item.variant_id == null && item.product_id != null
      );

      if (variantItems.length > 0) {
        await trx`
          update public.product_variants as pv
          set stock_quantity = pv.stock_quantity + update_data.qty::int
          from (values ${trx(
            variantItems.map((item) => [item.variant_id, item.quantity])
          )}) as update_data(id, qty)
          where pv.id = update_data.id::bigint
        `;
      }

      if (productItems.length > 0) {
        await trx`
          update public.products as p
          set stock_quantity = p.stock_quantity + update_data.qty::int
          from (values ${trx(
            productItems.map((item) => [item.product_id, item.quantity])
          )}) as update_data(id, qty)
          where p.id = update_data.id::bigint
        `;
      }

      if (items.length > 0) {
        const movementRows = items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          order_id: orderId,
          quantity_delta: item.quantity,
          reason: RESTOCK_MOVEMENT_REASON[targetStatus],
        }));
        // ⚠️ لا قائمة أعمدة ولا "values" يدويَين هنا — انظر التعليق المطابق
        // فـcreateOrder.ts (نفس الخطأ الحقيقي "UNDEFINED_VALUE" ونفس السبب
        // بالضبط: كتابتهما يدوياً تُفعِّل مُنشئ postgres.js الخاطئ).
        await trx`
          insert into public.stock_movements ${trx(movementRows, "product_id", "variant_id", "order_id", "quantity_delta", "reason")}
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
  return { error: null };
}
