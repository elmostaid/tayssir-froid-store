"use client";

import { useActionState } from "react";
import { updateOrderStatus, type OrderActionState } from "@/app/admin/(protected)/orders/actions";
import { ORDER_STATUSES } from "@/lib/orders/orderStatus";

const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  confirmed: "مؤكَّد",
  preparing: "قيد التحضير",
  ready: "جاهز للشحن",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  returned: "مرتجَع",
  cancelled: "ملغى (يُرجع المخزون المحجوز)",
};

const initialState: OrderActionState = { error: null };

export function OrderStatusForm({ orderId, currentStatus }: { orderId: number; currentStatus: string }) {
  const [state, formAction, isPending] = useActionState(updateOrderStatus, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="orderId" value={orderId} />
      <label className="flex-1 text-sm">
        <span className="mb-1 block font-medium text-neutral-700">تغيير الحالة</span>
        <select
          name="status"
          defaultValue={currentStatus}
          className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </label>
      <input
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
