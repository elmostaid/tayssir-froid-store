"use client";

import { useActionState, useState } from "react";
import { createManualOrderAction, type OrderEditState } from "@/app/admin/(protected)/orders/actions";
import { OrderLinesEditor } from "@/components/admin/OrderLinesEditor";
import { MANUAL_ORDER_SOURCES, ORDER_SOURCE_LABELS } from "@/lib/orders/orderSource";
import { ImportOrderPanel } from "@/components/admin/ImportOrderPanel";
import type { EditableLine } from "@/components/admin/OrderLinesEditor";
import type { ImportIssue, ImportedOrderDraft } from "@/lib/orders/importOrder";

const initialState: OrderEditState = { error: null };

function Field({
  label,
  name,
  required,
  type = "text",
  placeholder,
  maxLength,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  defaultValue?: string;
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
        defaultValue={defaultValue}
        className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
      />
    </label>
  );
}

export function ManualOrderForm() {
  const [state, formAction, pending] = useActionState(createManualOrderAction, initialState);
  const [draft, setDraft] = useState<ImportedOrderDraft | null>(null);
  const [warnings, setWarnings] = useState<ImportIssue[]>([]);

  // الاستيراد يُعيد بناء الحقول من الصفر: `key` مشتقّ من عدّاد المسودّات
  // يجعل React يُركِّب الحقول من جديد بقيمها الجديدة، بدل محاولة تحويل
  // نموذج غير مُتحكَّم فيه إلى مُتحكَّم فيه في منتصف حياته.
  const [draftKey, setDraftKey] = useState(0);

  function applyDraft(next: ImportedOrderDraft, nextWarnings: ImportIssue[]) {
    setDraft(next);
    setWarnings(nextWarnings);
    setDraftKey((current) => current + 1);
  }

  const importedLines: EditableLine[] = (draft?.items ?? []).map((item) => ({
    productId: item.productId,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    purchasePrice: item.purchasePrice,
    stockQuantity: item.stockQuantity,
    reservedQuantity: 0,
  }));

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      <ImportOrderPanel onDraft={applyDraft} />

      {draft && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-3">
          <p className="text-sm font-bold text-green-800">
            قُرئ البون: {draft.items.length} منتجاً — راجع كل شيء أدناه ثم أكّد.
          </p>
          <p className="mt-0.5 text-[11px] text-green-800">
            لم يُنشأ أي طلب بعد، ولم يتغيّر أي مخزون.
          </p>
          {warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-amber-800">
              {warnings.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-800">الزبون</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            key={`name-${draftKey}`}
            label="اسم الزبون"
            name="fullName"
            required
            maxLength={100}
            defaultValue={draft?.customerName}
          />
          <Field
            key={`phone-${draftKey}`}
            label="الهاتف"
            name="phone"
            required
            type="tel"
            placeholder="0612345678"
            defaultValue={draft?.phone}
          />
          <Field
            key={`city-${draftKey}`}
            label="المدينة"
            name="city"
            required
            maxLength={100}
            defaultValue={draft?.city}
          />
          <Field
            key={`address-${draftKey}`}
            label="العنوان الكامل"
            name="address"
            required
            maxLength={300}
            defaultValue={draft?.address}
          />
          <label className="text-xs text-neutral-700">
            <span className="mb-1 block font-semibold">
              مصدر الطلب <span className="text-red-500">*</span>
            </span>
            <select
              key={`source-${draftKey}`}
              name="source"
              required
              defaultValue={draft?.source ?? "whatsapp"}
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
              key={`notes-${draftKey}`}
              type="text"
              name="notes"
              maxLength={500}
              defaultValue={draft?.notes}
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-800">المنتجات</h2>
        <div className="mt-3">
          <OrderLinesEditor
            key={`lines-${draftKey}`}
            initialLines={importedLines}
            initialDeliveryFee={draft?.deliveryFee ?? 0}
            disabled={pending}
          />
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
          {pending ? "جارٍ الحفظ…" : draft ? "تأكيد وإنشاء الطلب" : "حفظ الطلب"}
        </button>
        <p className="text-[11px] text-neutral-500">
          يُحفظ بحالة «مؤكَّد» ويأخذ رقماً عادياً كبقية الطلبات. لا يُرسَل أي حدث إلى Meta.
        </p>
      </div>
    </form>
  );
}
