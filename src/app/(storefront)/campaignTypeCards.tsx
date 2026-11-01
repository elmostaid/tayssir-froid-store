import Link from "next/link";
import { ProductImage } from "@/components/ProductImage";
import { CARD_WIDTHS, THUMB_WIDTHS } from "@/lib/images/variants";
import type { CampaignTab } from "@/app/(storefront)/campaignLanding";

export type CampaignTypeCard = {
  tab: CampaignTab;
  href: string;
  /** المسار كما هو مخزَّن (رابط الصورة اليدوية أو `storage_path` منتج). */
  imagePath: string | null;
  /** الرابط الجاهز للعرض (`resolveProductImageUrl`). */
  imageSrc: string | null;
  /** صورة يدوية من لوحة الإدارة: لا نسخ WebP لها، فتُعرض كما رُفعت. */
  isManual: boolean;
};

/**
 * بطاقات الأنواع بصورها — أول ما يراه زائر الإعلان.
 *
 * ## الشكلان
 *
 * - **نوعان** (الشوفو): بطاقتان جنباً إلى جنب حتى على الهاتف، بصورة كبيرة
 *   4:3. ثلاثة أرباع عرض البطاقة صورة: الزائر يعرف نوع جهازه بالعين قبل
 *   أن يقرأ.
 * - **ثلاثة** (مكينات الصابون): على الهاتف صفوف أفقية (صورة مربّعة 80px +
 *   الاسم كاملاً)، لأن ثلاث بطاقات في عرض 360px تقصّ «نصف أوتوماتيك» وتصغّر
 *   الصورة إلى ما لا يُقرأ. ومن sm ثلاثة أعمدة بنفس شكل بطاقتي الشوفو.
 *
 * والبطاقات كلها **متساوية**: نفس الحجم والحدود ولا واحدة «نشطة» — نفس
 * قاعدة الوجه المحايد (`campaignOverview.tsx`).
 *
 * ## السرعة
 *
 * البطاقات فوق الطيّة، فصورها وحدها بأولوية (2–3 صور صغيرة)، وصور منتجات
 * الأقسام تحتها كسولة. وصور المنتجات تأخذ نسخة WebP بعرض 360px، والصور
 * اليدوية تُرفع مصغَّرة أصلاً (≤ 900px) — لا صورة 1600px على هاتف.
 */
export function CampaignTypeCards({
  cards,
  ariaLabel,
}: {
  cards: CampaignTypeCard[];
  ariaLabel: string;
}) {
  const pair = cards.length === 2;

  return (
    <nav
      aria-label={ariaLabel}
      className={pair ? "mt-4 grid grid-cols-2 gap-3" : "mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3"}
    >
      {cards.map((card) => {
        const name = card.tab.fullLabel ?? card.tab.label;
        return (
          <Link
            key={card.tab.key}
            href={card.href}
            prefetch={false}
            data-campaign-type={card.tab.key}
            className={
              pair
                ? "group flex flex-col overflow-hidden rounded-2xl border-2 border-brand-turquoise/40 bg-white shadow-sm transition-colors hover:border-brand-turquoise active:border-brand-turquoise"
                : "group flex items-center gap-3 overflow-hidden rounded-2xl border-2 border-brand-turquoise/40 bg-white p-2 shadow-sm transition-colors hover:border-brand-turquoise active:border-brand-turquoise sm:flex-col sm:items-stretch sm:gap-0 sm:p-0"
            }
          >
            <div
              className={
                pair
                  ? "relative aspect-[4/3] w-full bg-neutral-100"
                  : "relative size-20 shrink-0 overflow-hidden rounded-xl bg-neutral-100 sm:aspect-[4/3] sm:size-auto sm:w-full sm:rounded-none"
              }
            >
              {card.imagePath && card.imageSrc ? (
                <ProductImage
                  storagePath={card.imagePath}
                  resolvedSrc={card.imageSrc}
                  alt={`قطع غيار ${name}`}
                  sizes={pair ? "(max-width: 640px) 50vw, 360px" : "(max-width: 640px) 80px, 33vw"}
                  widths={card.isManual ? null : pair ? CARD_WIDTHS : THUMB_WIDTHS}
                  priority
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null}
            </div>
            <div className={pair ? "flex flex-1 flex-col gap-1 p-3" : "flex min-w-0 flex-1 flex-col gap-0.5 sm:p-3"}>
              <span className="text-[11px] font-medium text-neutral-500">قطع غيار</span>
              <span className="text-sm font-bold leading-5 text-neutral-800 sm:text-base">{name}</span>
              <span className="mt-auto pt-1 text-xs font-bold text-brand-turquoise-dark">
                شوف القطع <span aria-hidden="true">←</span>
              </span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
