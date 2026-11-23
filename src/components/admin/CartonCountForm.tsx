"use client";

import { useActionState } from "react";
import { updateCartonCount, type OrderActionState } from "@/app/admin/(protected)/orders/actions";

const initialState: OrderActionState = { error: null };

/** «شحال من كرطونة خرجات» — اختياري، يُملأ بعد التغليف. */
export function CartonCountForm({ orderId, current }: { orderId: number; current: number | null }) {
  const [state, formAction, isPending] = useActionState(updateCartonCount, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex items-end gap-2">
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium text-neutral-700">عدد الكرطونات (اختياري)</span>
          <input
            key={current ?? "none"}
            name="cartonCount"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            step={1}
            defaultValue={current ?? ""}
            placeholder="بعد التغليف"
            className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 shrink-0 rounded-lg bg-neutral-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isPending ? "…" : "حفظ"}
        </button>
      </div>
      {state.error ? (
        <p className="text-xs text-red-700">{state.error}</p>
      ) : (
        <p className="text-xs text-neutral-500">
          {current === null
            ? "غير مسجَّل. إلا سجلتيه، تسوية التوصيل كتعرف واش وصلات جميع الكرطونات."
            : `${current} كرطونة — تسوية التوصيل كتستنى هاد العدد كامل.`}
        </p>
      )}
    </form>
  );
}
