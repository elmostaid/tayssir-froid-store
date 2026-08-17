"use client";

import type { BulkPreviewPlan } from "@/app/admin/(protected)/products/bulkActions";

export type ReviewItem = {
  clientId: string;
  /** الاسم النهائي: ما كتبه صاحب المتجر، أو الاسم المولَّد فعلياً. */
  finalName: string;
  isAutoName: boolean;
  purchasePrice: string;
  salePrice: string;
  stock: string;
  minOrderQty: string;
  imagePreviewUrl: string | null;
  imageCount: number;
  /** أسباب المنع — تُعرض للمستخدم بوضوح بدل رفض صامت. */
  problems: string[];
};

/**
 * شاشة مراجعة قبل الحفظ. لا تكتب شيئاً في قاعدة البيانات — تعرض فقط ما
 * سيحدث فعلاً: الاسم النهائي (بما فيه المولَّد تلقائياً)، الأثمنة، المخزون،
 * أقل عدد، التصنيف، والوصف الذي سيُحفَظ.
 *
 * أي منتج فيه مشكلة يظهر بإطار أحمر وسبب مكتوب، ولا يُخفى ولا يمنع رؤية
 * البقية — صاحب المتجر يرى بالضبط ما الناقص وأين.
 */
export function BulkReviewPanel({
  items,
  plan,
  categoryLabel,
  onBack,
  onConfirm,
  isSaving,
}: {
  items: ReviewItem[];
  plan: BulkPreviewPlan | null;
  categoryLabel: string;
  onBack: () => void;
  onConfirm: () => void;
  isSaving: boolean;
}) {
  const blocked = items.filter((i) => i.problems.length > 0);
  const ready = items.length - blocked.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-brand-turquoise/40 bg-brand-turquoise-tint/50 p-3">
        <h2 className="text-sm font-bold text-neutral-900">مراجعة قبل الحفظ</h2>
        <p className="mt-1 text-xs text-neutral-700">
          التصنيف: <span className="font-semibold">{categoryLabel}</span>
          {plan?.firstSku && (
            <>
              {" · "}أول رمز سيُولَّد: <span className="font-semibold">{plan.firstSku}</span>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-neutral-700">
          جاهز للحفظ: <span className="font-semibold text-green-700">{ready}</span>
          {blocked.length > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-red-700">{blocked.length} فيه مشكلة</span>
            </>
          )}
        </p>
      </div>

      {plan?.description && (
        <details className="rounded-xl border border-neutral-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold text-neutral-700">
            الوصف الذي سيُحفَظ لكل منتج
          </summary>
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-neutral-600">
            {plan.description}
          </p>
        </details>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li
            key={item.clientId}
            className={`flex gap-3 rounded-xl border bg-white p-3 ${
              item.problems.length > 0 ? "border-red-400 bg-red-50/40" : "border-neutral-200"
            }`}
          >
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
              {item.imagePreviewUrl ? (
                // صورة محلية من الجهاز قبل الرفع — عنصر img عادي عن قصد:
                // next/image لا يتعامل مع blob: من اختيار ملف.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imagePreviewUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-400">
                  بلا صورة
                </span>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-xs text-neutral-400">منتج {index + 1}</span>
              <span className="text-sm font-semibold text-neutral-900">
                {item.finalName}
                {item.isAutoName && (
                  <span className="mr-2 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                    اسم تلقائي
                  </span>
                )}
              </span>
              <span className="text-xs text-neutral-600">
                شراء: {item.purchasePrice || "—"} · بيع:{" "}
                <span className="font-semibold text-brand-orange">{item.salePrice || "—"}</span>
              </span>
              <span className="text-xs text-neutral-600">
                المخزون: {item.stock} · أقل عدد: {item.minOrderQty} · الصور: {item.imageCount}
              </span>
              {item.problems.map((problem) => (
                <span key={problem} className="text-xs font-semibold text-red-700">
                  ⚠ {problem}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSaving || ready === 0}
          className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-brand-orange px-6 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSaving ? "جارٍ الحفظ…" : `إضافة المجموعة كاملة (${ready})`}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="flex min-h-12 flex-1 items-center justify-center rounded-full border border-neutral-300 px-6 text-sm font-semibold text-neutral-700 disabled:opacity-60"
        >
          رجوع للتعديل
        </button>
      </div>
    </div>
  );
}
