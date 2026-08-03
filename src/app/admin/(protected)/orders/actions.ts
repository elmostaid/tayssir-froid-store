"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/queries/adminOrders";

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

  if (status === "cancelled") {
    return cancelOrderInternal(orderId, admin.email, note);
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

  return cancelOrderInternal(orderId, admin.email, note);
}

// إلغاء الطلب: يُرجع المخزون المحجوز عند إنشائه (سطراً بسطر، مع تسجيل حركة
// مخزون معاكسة لكل سطر)، ويمنع إلغاء نفس الطلب مرتين (فحص الحالة الحالية
// داخل نفس Transaction قبل أي تحديث).
async function cancelOrderInternal(
  orderId: number,
  adminEmail: string,
  note: string | null
): Promise<OrderActionState> {
  try {
    await sql.begin(async (trx) => {
      const [order] = await trx<{ status: string }[]>`
        select status from public.orders where id = ${orderId} for update
      `;
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status === "cancelled") throw new Error("ALREADY_CANCELLED");

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
            ${item.product_id}, ${item.variant_id}, ${orderId}, ${item.quantity}, 'order_cancelled'
          )
        `;
      }

      await trx`update public.orders set status = 'cancelled' where id = ${orderId}`;
      await trx`
        insert into public.order_status_history (order_id, status, note, changed_by)
        values (${orderId}, 'cancelled', ${note ?? "تم إلغاء الطلب وإرجاع المخزون"}, ${adminEmail})
      `;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_CANCELLED") {
      return { error: "هذا الطلب مُلغى مسبقاً." };
    }
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      return { error: "الطلب غير موجود." };
    }
    console.error("cancelOrderInternal: خطأ غير متوقع", error);
    return { error: "تعذّر إلغاء الطلب حالياً بسبب مشكلة تقنية." };
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return { error: null };
}
