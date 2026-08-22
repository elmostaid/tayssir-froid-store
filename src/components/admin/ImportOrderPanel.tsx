"use client";

import { useRef, useState, useTransition } from "react";
import { importOrderDraftAction } from "@/app/admin/(protected)/orders/actions";
import type { ImportIssue, ImportedOrderDraft } from "@/lib/orders/importOrder";

const SAMPLE = `{
  "customer_name": "عبد الحق",
  "phone": "0673155475",
  "city": "تندرار",
  "address": "حي الرجاء في الله شارع الادريس الاول",
  "source": "whatsapp",
  "delivery_fee": 45,
  "notes": "",
  "items": [
    { "sku": "TF-AC-044", "quantity": 1, "unit_price": 1000 },
    { "sku": "TF-RF-R22-3KG", "quantity": 1, "unit_price": 850 }
  ]
}`;

/**
 * استيراد بون واتساب: رفع ملف أو لصق نص.
 *
 * القراءة والإنشاء مفصولان عمداً. هذا القسم **لا ينشئ طلباً ولا يخصم
 * مخزوناً** — يقرأ البون، يطابق كل كود مع منتج حقيقي، ثم يملأ النموذج
 * أدناه ليراجعه إنسان. المخزون لا يتحرّك إلا بعد «تأكيد وإنشاء الطلب».
 */
export function ImportOrderPanel({
  onDraft,
}: {
  onDraft: (draft: ImportedOrderDraft, warnings: ImportIssue[]) => void;
}) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<ImportIssue[]>([]);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function read(json: string) {
    setErrors([]);
    startTransition(async () => {
      const result = await importOrderDraftAction(json);
      if (result.ok) {
        setErrors([]);
        onDraft(result.draft, result.warnings);
      } else {
        setErrors(result.errors);
      }
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      read(content);
    } catch {
      setErrors([{ field: "file", message: "تعذّرت قراءة الملف." }]);
    }
  }

  return (
    <section className="rounded-xl border border-brand-turquoise/40 bg-brand-turquoise-tint/40 p-4">
      <h2 className="text-sm font-bold text-neutral-800">استيراد بون / Import Order</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
        ارفع ملف JSON أو الصق محتواه. سيُقرأ ويُطابَق مع منتجاتك ثم يملأ النموذج أدناه لتراجعه —{" "}
        <span className="font-semibold">لا يُنشأ طلب ولا يتغيّر مخزون قبل التأكيد.</span>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,text/plain"
          disabled={pending}
          onChange={(event) => onFile(event.target.files?.[0])}
          className="text-xs file:mr-2 file:min-h-9 file:rounded-full file:border-0 file:bg-brand-turquoise file:px-3 file:text-xs file:font-semibold file:text-white"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => setText(SAMPLE)}
          className="min-h-9 rounded-full border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700"
        >
          أدرج مثالاً
        </button>
      </div>

      <label className="mt-3 block text-xs text-neutral-700">
        <span className="mb-1 block font-semibold">أو الصق البيانات هنا</span>
        <textarea
          value={text}
          disabled={pending}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          dir="ltr"
          spellCheck={false}
          placeholder={SAMPLE}
          className="w-full rounded-lg border border-neutral-300 p-2 font-mono text-[11px] leading-relaxed"
        />
      </label>

      <button
        type="button"
        disabled={pending || text.trim() === ""}
        onClick={() => read(text)}
        className="mt-2 min-h-11 rounded-full bg-brand-turquoise px-5 text-sm font-semibold text-white disabled:bg-neutral-300"
      >
        {pending ? "جارٍ القراءة…" : "اقرأ البون واملأ النموذج"}
      </button>

      {errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-xs font-bold text-red-700">
            لم يُقرأ البون ({errors.length}{" "}
            {errors.length === 1 ? "مشكلة" : "مشاكل"}) — لم يُنشأ أي طلب ولم يتغيّر المخزون:
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-red-700">
            {errors.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
