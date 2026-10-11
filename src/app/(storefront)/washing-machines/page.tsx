import type { Metadata } from "next";
import { CampaignLanding, type CampaignTab } from "@/app/(storefront)/campaignLanding";
import { getSiteUrl } from "@/lib/siteUrl";

// الأثمنة والمخزون من قاعدة البيانات، فلا تُخزَّن الصفحة مُصيَّرةً.
export const dynamic = "force-dynamic";

const BASE_PATH = "/washing-machines";

/**
 * الترتيب هنا ليس اعتباطياً: **العادية أولاً** لأنها الافتراضي.
 *
 * والسبب مقيس لا مُفترَض — من مبيعات الطلبات المؤكَّدة والمشحونة
 * والمُسلَّمة: العادية 89,363 درهماً من 55 طلباً، مقابل 3,215 للأوتوماتيك
 * و1,905 لنصف الأوتوماتيك. أي أن 94% من إيراد مكينات الصابون يأتي من
 * التصنيف الأول، رغم أنه أقلّ من نصف عدد منتجات الأوتوماتيك.
 */
export const WASHING_TABS: CampaignTab[] = [
  { key: "standard", label: "العادية", categorySlug: "standard-washing-machine-parts" },
  { key: "semi", label: "نصف أوتوماتيك", categorySlug: "semi-automatic-washing-machine-parts" },
  { key: "automatic", label: "أوتوماتيك", categorySlug: "automatic-washing-machine-parts" },
];

const TITLE = "قطع غيار مكينات الصابون";
const DESCRIPTION =
  "قطع غيار مكينات الصابون العادية ونصف الأوتوماتيكية والأوتوماتيكية — بالقطعة والجملة، الدفع عند الاستلام، والتوصيل لجميع مناطق المغرب.";

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = getSiteUrl();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: siteUrl ? { canonical: BASE_PATH } : undefined,
    openGraph: { title: TITLE, description: DESCRIPTION, url: siteUrl ? BASE_PATH : undefined },
  };
}

export default async function WashingMachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;

  return (
    <CampaignLanding
      title={TITLE}
      subtitle="العادية · نصف أوتوماتيك · أوتوماتيك — بالقطعة والجملة"
      hint="اختر نوع المكينة ديالك وشوف القطع المناسبة ليها."
      basePath={BASE_PATH}
      tabs={WASHING_TABS}
      requestedType={type}
    />
  );
}
