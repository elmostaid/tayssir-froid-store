"use client";

import { useActionState } from "react";
import { updateDeliveryFee, type OrderActionState } from "@/app/admin/(protected)/orders/actions";

const initialState: OrderActionState = { error: null };

export function DeliveryFeeForm({
  orderId,
  currentDeliveryFee,
}: {
  orderId: number;
  currentDeliveryFee: string | null;
}) {
  const [state, formAction, isPending] = useActionState(updateDeliveryFee, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="orderId" value={orderId} />
      <label className="flex-1 text-sm">
        <span className="mb-1 block font-medium text-neutral-700">مصاريف التوصيل (درهم)</span>
        <input
          key={currentDeliveryFee}
          name="deliveryFee"
          type="number"
          min={0}
          step="0.01"
          defaultValue={currentDeliveryFee ?? ""}
          placeholder="مثال: 45"
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 shrink-0 rounded-lg bg-brand-turquoise px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "جارٍ الحفظ…" : "حفظ مصاريف التوصيل"}
      </button>
      {state.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
