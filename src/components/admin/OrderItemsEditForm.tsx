"use client";

import { useActionState, useState } from "react";
import { updateOrderLinesAction, type OrderEditState } from "@/app/admin/(protected)/orders/actions";
import { OrderLinesEditor, type EditableLine } from "@/components/admin/OrderLinesEditor";

const initialState: OrderEditState = { error: null };

/**
 * تعديل محتوى طلب قائم. مطويّ افتراضياً: أغلب زيارات صفحة الطلب للاطّلاع أو
 * لتغيير الحالة، وفتح محرّر يمسّ المال والمخزون في كل مرة دعوةٌ للخطأ.
 */
export function OrderItemsEditForm({
  orderId,
  lines,
  deliveryFee,
  lockedReason,
}: {
  orderId: number;
  lines: EditableLine[];
  deliveryFee: number;
  /** سبب منع التعديل، إن وُجد (طلب ملغى أو راجع). */
  lockedReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateOrderLinesAction, initialState);

  if (lockedReason) {
    return (
      <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600">
        {lockedReason}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 min-h-11 rounded-full border border-brand-orange px-4 text-sm font-semibold text-brand-orange"
      >
        تعديل محتوى الطلب
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 rounded-xl border border-brand-orange/40 bg-white p-3">
      <input type="hidden" name="orderId" value={orderId} />
      <p className="mb-3 text-xs leading-relaxed text-neutral-600">
        المخزون يُصحَّح <span className="font-semibold">بالفرق فقط</span>: زيادة الكمية تحجز
        الفارق، وإنقاصها يُرجعه. المجموع والربح يُعاد حسابهما فور الحفظ.
      </p>

      <OrderLinesEditor initialLines={lines} initialDeliveryFee={deliveryFee} disabled={pending} />

      {state.error && (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {state.error}
        </p>
      )}
      {state.error === null && !pending && (
        <p className="sr-only" role="status">
          تم الحفظ
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-brand-orange px-5 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {pending ? "جارٍ الحفظ…" : "حفظ التعديل"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="min-h-11 rounded-full border border-neutral-300 px-5 text-sm font-semibold text-neutral-700"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}
