"use client";

import { useActionState, useRef } from "react";
import { addOrderNote, type OrderActionState } from "@/app/admin/(protected)/orders/actions";

const initialState: OrderActionState = { error: null };

export function OrderNoteForm({ orderId }: { orderId: number }) {
  const [state, formAction, isPending] = useActionState(addOrderNote, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await formAction(formData);
        formRef.current?.reset();
      }}
      className="flex gap-2"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input
        name="note"
        required
        placeholder="أضف ملاحظة داخلية…"
        className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 shrink-0 rounded-lg border border-neutral-300 px-4 text-sm font-semibold text-neutral-700 disabled:opacity-60"
      >
        إضافة
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
