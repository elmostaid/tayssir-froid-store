import { formatMad } from "@/lib/format";
import { describeTiers, type TierPricing } from "@/lib/pricing/tierPricing";

/**
 * جدول مستويات الأثمنة في صفحة المنتج.
 *
 * منتج بثمن واحد لا يعرض شيئاً إطلاقاً (describeTiers ترجع مصفوفة فارغة) —
 * لا "tiers فارغة" ولا جدول بسطر واحد، يبقى عرضه بسيطاً كما هو اليوم.
 */
export function PriceTiersTable({
  pricing,
  unitLabel,
  startQty,
  activeQuantity,
}: {
  pricing: TierPricing;
  unitLabel: string;
  startQty: number;
  /** الكمية المختارة حالياً — لإبراز المستوى المطبَّق فعلاً (اختياري) */
  activeQuantity?: number;
}) {
  const tiers = describeTiers(pricing, startQty);
  if (tiers.length === 0) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200">
      <div className="bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-700">
        الثمن حسب الكمية
      </div>
      <ul className="divide-y divide-neutral-100">
        {tiers.map((tier) => {
          const isActive =
            activeQuantity !== undefined &&
            activeQuantity >= tier.minQty &&
            (tier.maxQty === null || activeQuantity <= tier.maxQty);

          return (
            <li
              key={`${tier.minQty}-${tier.maxQty ?? "max"}`}
              className={`flex items-center justify-between px-3 py-2 text-sm ${
                isActive ? "bg-brand-turquoise-tint font-semibold" : "bg-white"
              }`}
            >
              <span className="text-neutral-700">
                {tier.maxQty === null
                  ? `${tier.minQty}+ ${unitLabel}`
                  : `${tier.minQty}–${tier.maxQty} ${unitLabel}`}
              </span>
              <span className={isActive ? "text-brand-orange" : "text-neutral-800"}>
                {formatMad(tier.unitPrice)} / {unitLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
