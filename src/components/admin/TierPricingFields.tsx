"use client";

import type { PricingMode } from "@/lib/pricing/tierPricing";

const MODE_OPTIONS: { value: PricingMode; label: string }[] = [
  { value: "single", label: "ثمن واحد" },
  { value: "two_tier", label: "مستويان (وحدة + جملة)" },
  { value: "three_tier", label: "3 مستويات (وحدة + جملة + جملة كبيرة)" },
];

const inputClass =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none";

/**
 * إعدادات التسعير لمنتج واحد في لوحة الإدارة.
 *
 * الحقول شرطية عمداً: نمط "ثمن واحد" لا يعرض أي حقل مستوى إطلاقاً، ونمط
 * "مستويان" لا يعرض حقول المستوى الثالث — حتى لا يبقى المدير أمام حقول
 * فارغة لا معنى لها. عتبات الكميات مُدخَلة يدوياً بالكامل ولا توجد أي قيمة
 * مقترحة أو مفروضة (لا 10 ولا 50): كل منتج له عتباته الخاصة.
 */
export function TierPricingFields({
  pricingMode,
  onPricingModeChange,
  values,
  onChange,
  showBulkWhatsapp,
  onShowBulkWhatsappChange,
  unitLabel,
  hasActiveVariants,
  fieldError,
}: {
  pricingMode: PricingMode;
  onPricingModeChange: (mode: PricingMode) => void;
  values: {
    tier2MinQty: string;
    tier2Price: string;
    tier3MinQty: string;
    tier3Price: string;
  };
  onChange: (key: keyof typeof values, value: string) => void;
  showBulkWhatsapp: boolean;
  onShowBulkWhatsappChange: (checked: boolean) => void;
  unitLabel: string;
  hasActiveVariants: boolean;
  fieldError: (field: string) => string | undefined;
}) {
  const isTiered = pricingMode === "two_tier" || pricingMode === "three_tier";
  const isThreeTier = pricingMode === "three_tier";
  const unit = unitLabel.trim() || "قطعة";

  return (
    <fieldset className="rounded-xl border border-neutral-200 p-3">
      <legend className="px-1 text-sm font-semibold text-neutral-700">التسعير حسب الكمية</legend>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">نوع التسعير *</span>
        <select
          name="pricingMode"
          value={pricingMode}
          onChange={(e) => onPricingModeChange(e.target.value as PricingMode)}
          className={inputClass}
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-neutral-500">
          «ثمن البيع» أعلاه هو دائماً ثمن المستوى الأول (ثمن {unit} الواحدة).
          الكمية الدنيا للطلب مستقلة تماماً عن هذا الإعداد.
        </span>
      </label>

      {isTiered && (
        <>
          <p className="mt-3 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
            عند بلوغ مستوى، ثمنه يُطبَّق على <strong>كل</strong> الكمية المطلوبة من هذا
            المنتج، لا على الزائد فقط.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-neutral-700">
                يبدأ ثمن الجملة من ({unit}) *
              </span>
              <input
                name="tier2MinQty"
                type="number"
                min={2}
                step={1}
                value={values.tier2MinQty}
                onChange={(e) => onChange("tier2MinQty", e.target.value)}
                className={inputClass}
              />
              {fieldError("tier2MinQty") && (
                <span className="mt-1 block text-xs text-red-600">{fieldError("tier2MinQty")}</span>
              )}
            </label>

            <label className="text-sm">
              <span className="mb-1 block font-medium text-neutral-700">ثمن الجملة (درهم) *</span>
              <input
                name="tier2Price"
                type="number"
                min={0}
                step="0.01"
                value={values.tier2Price}
                onChange={(e) => onChange("tier2Price", e.target.value)}
                className={inputClass}
              />
              {fieldError("tier2Price") && (
                <span className="mt-1 block text-xs text-red-600">{fieldError("tier2Price")}</span>
              )}
            </label>
          </div>
        </>
      )}

      {isThreeTier && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-700">
              تبدأ الجملة الكبيرة من ({unit}) *
            </span>
            <input
              name="tier3MinQty"
              type="number"
              min={2}
              step={1}
              value={values.tier3MinQty}
              onChange={(e) => onChange("tier3MinQty", e.target.value)}
              className={inputClass}
            />
            {fieldError("tier3MinQty") && (
              <span className="mt-1 block text-xs text-red-600">{fieldError("tier3MinQty")}</span>
            )}
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-700">
              ثمن الجملة الكبيرة (درهم) *
            </span>
            <input
              name="tier3Price"
              type="number"
              min={0}
              step="0.01"
              value={values.tier3Price}
              onChange={(e) => onChange("tier3Price", e.target.value)}
              className={inputClass}
            />
            {fieldError("tier3Price") && (
              <span className="mt-1 block text-xs text-red-600">{fieldError("tier3Price")}</span>
            )}
          </label>
        </div>
      )}

      {isTiered && hasActiveVariants && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ هذا المنتج له متغيّرات (مقاسات/أنواع). التسعير المتدرِّج يُطبَّق على ثمن
          المنتج الأساسي فقط: كل متغيّر له <strong>ثمن خاص</strong> يُباع بذلك الثمن
          الواحد لكل الكميات ولا تنطبق عليه هذه المستويات إطلاقاً. المتغيّر بلا ثمن
          خاص هو وحده من يرث المستويات أعلاه.
        </p>
      )}

      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="showBulkWhatsapp"
          checked={showBulkWhatsapp}
          onChange={(e) => onShowBulkWhatsappChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300"
        />
        <span>
          <span className="font-medium text-neutral-700">
            إظهار التواصل عبر واتساب للكميات الكبيرة
          </span>
          <span className="mt-0.5 block text-xs text-neutral-500">
            يعرض في صفحة المنتج رابطاً صغيراً: «باغي كمية كبيرة؟ تواصل معنا عبر واتساب
            لثمن خاص». مستقل تماماً عن نوع التسعير (يمكن تفعيله على منتج بثمن واحد)،
            ولا يمنع الزبون من الشراء المباشر من الموقع.
          </span>
        </span>
      </label>
    </fieldset>
  );
}
