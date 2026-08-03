"use client";

import { useActionState, useRef } from "react";
import { updateOrderStatus, type OrderActionState } from "@/app/admin/(protected)/orders/actions";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/orders/orderStatus";

const initialState: OrderActionState = { error: null };

export function OrderStatusForm({ orderId, currentStatus }: { orderId: number; currentStatus: string }) {
  const [state, formAction, isPending] = useActionState(updateOrderStatus, initialState);
  const noteRef = useRef<HTMLInputElement>(null);

  return (
    <form
      action={async (formData) => {
        await formAction(formData);
        if (noteRef.current) noteRef.current.value = "";
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <label className="flex-1 text-sm">
        <span className="mb-1 block font-medium text-neutral-700">تغيير الحالة</span>
        {/* key={currentStatus}: defaultValue على عنصر <select> غير المُتحكَّم به
            (uncontrolled) لا يُعاد تطبيقه تلقائياً عند تغيّر الـprop فقط —
            يحتاج React لمعاملة العنصر كجديد كلياً (remount) ليأخذ القيمة
            المحدَّثة بعد نجاح تغيير الحالة فعلياً في قاعدة البيانات. */}
        <select
          key={currentStatus}
          name="status"
          defaultValue={currentStatus}
          className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
              {s === "cancelled" ? " (يُرجع المخزون المحجوز)" : ""}
            </option>
          ))}
        </select>
      </label>
      <input
        ref={noteRef}
        name="note"
        placeholder="ملاحظة اختيارية"
        className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 shrink-0 rounded-lg bg-brand-orange px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "جارٍ الحفظ…" : "حفظ"}
      </button>
      {state.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
