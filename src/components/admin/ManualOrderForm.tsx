"use client";

import { useActionState } from "react";
import { createManualOrderAction, type OrderEditState } from "@/app/admin/(protected)/orders/actions";
import { OrderLinesEditor } from "@/components/admin/OrderLinesEditor";
import { MANUAL_ORDER_SOURCES, ORDER_SOURCE_LABELS } from "@/lib/orders/orderSource";

const initialState: OrderEditState = { error: null };

function Field({
  label,
  name,
  required,
  type = "text",
  placeholder,
  maxLength,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className="text-xs text-neutral-700">
      <span className="mb-1 block font-semibold">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
      />
    </label>
  );
}

export function ManualOrderForm() {
  const [state, formAction, pending] = useActionState(createManualOrderAction, initialState);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-800">الزبون</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="اسم الزبون" name="fullName" required maxLength={100} />
          <Field label="الهاتف" name="phone" required type="tel" placeholder="0612345678" />
          <Field label="المدينة" name="city" required maxLength={100} />
          <Field label="العنوان الكامل" name="address" required maxLength={300} />
          <label className="text-xs text-neutral-700">
            <span className="mb-1 block font-semibold">
              مصدر الطلب <span className="text-red-500">*</span>
            </span>
            <select
              name="source"
              required
              defaultValue="whatsapp"
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
            >
              {MANUAL_ORDER_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {ORDER_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-700">
            <span className="mb-1 block font-semibold">ملاحظة (اختياري)</span>
            <input
              type="text"
              name="notes"
              maxLength={500}
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-800">المنتجات</h2>
        <div className="mt-3">
          <OrderLinesEditor initialLines={[]} initialDeliveryFee={0} disabled={pending} />
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-brand-orange px-6 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {pending ? "جارٍ الحفظ…" : "حفظ الطلب"}
        </button>
        <p className="text-[11px] text-neutral-500">
          يُحفظ بحالة «مؤكَّد» ويأخذ رقماً عادياً كبقية الطلبات. لا يُرسَل أي حدث إلى Meta.
        </p>
      </div>
    </form>
  );
}
