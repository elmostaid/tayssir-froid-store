import type { Metadata } from "next";
import { CampaignLanding, type CampaignTab } from "@/app/(storefront)/campaignLanding";
import { getSiteUrl } from "@/lib/siteUrl";

// الأثمنة والمخزون من قاعدة البيانات، فلا تُخزَّن الصفحة مُصيَّرةً.
export const dynamic = "force-dynamic";

const BASE_PATH = "/water-heaters";

/**
 * **الغازي أولاً**، وهو الافتراضي.
 *
 * مقيسٌ كذلك: الغازي 40 منتجاً و21 طلباً و9,550 درهماً، مقابل 10 منتجات
 * و5 طلبات و5,956 درهماً للكهربائي. أي أربعة أضعاف المعروض وأربعة أضعاف
 * الطلبات. (وللإنصاف: الكهربائي أغلى للقطعة — 596 درهماً لكل منتج مقابل
 * 239 — فلو ركّز الفيديو عليه يُقلب هذا الترتيب بسطر واحد هنا.)
 */
export const HEATER_TABS: CampaignTab[] = [
  { key: "gas", label: "الشوفو الغازي", categorySlug: "gas-water-heater-parts" },
  { key: "electric", label: "الشوفو الكهربائي", categorySlug: "electric-water-heater-parts" },
];

const TITLE = "قطع غيار الشوفو";
const DESCRIPTION =
  "قطع غيار الشوفو الغازي والكهربائي — بالقطعة والجملة، الدفع عند الاستلام، والتوصيل لجميع مناطق المغرب.";

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = getSiteUrl();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: siteUrl ? { canonical: BASE_PATH } : undefined,
    openGraph: { title: TITLE, description: DESCRIPTION, url: siteUrl ? BASE_PATH : undefined },
  };
}

export default async function WaterHeatersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;

  return (
    <CampaignLanding
      title={TITLE}
      subtitle="الغازي والكهربائي — بالقطعة والجملة"
      hint="اختر نوع الشوفو ديالك وشوف القطع المناسبة ليها."
      basePath={BASE_PATH}
      tabs={HEATER_TABS}
      requestedType={type}
    />
  );
}
