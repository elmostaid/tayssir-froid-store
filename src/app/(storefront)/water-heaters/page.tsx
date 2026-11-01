import type { Metadata } from "next";
import { CampaignLanding, type CampaignTab } from "@/app/(storefront)/campaignLanding";
import { CampaignOverview, resolveLandingView } from "@/app/(storefront)/campaignOverview";
import { getSiteUrl } from "@/lib/siteUrl";

// الأثمنة والمخزون من قاعدة البيانات، فلا تُخزَّن الصفحة مُصيَّرةً.
export const dynamic = "force-dynamic";

const BASE_PATH = "/water-heaters";

/**
 * الغازي والكهربائي **متساويان** في الدخول من الإعلان (الوجه المحايد،
 * `campaignOverview.tsx`) — نفس قرار صفحة مكينات الصابون.
 *
 * كانت الصفحة تفتح الغازي مباشرة، فأول ما يراه الزائر 24 قطعة غازية
 * والكهربائي زرٌّ صغير فوقها. والنتيجة المقيسة: 46,011 درهماً غازياً مقابل
 * 2,064 كهربائياً — لا نعرف كم منها طلبٌ حقيقي وكم أثر الترتيب. الآن
 * بطاقتان بصورتين بنفس الحجم من أول الشاشة.
 *
 * `?type=gas` و`?type=electric` يبقيان كما هما حرفياً (روابط الإعلانات).
 * `coverSku`: القطعة الأكثر طلباً في كل نوع (دويت الغاز 53 طلباً، لنود
 * الكهرباء) — صورة البطاقة ما لم تُرفع صورة يدوية من لوحة الإدارة.
 */
export const HEATER_TABS: CampaignTab[] = [
  {
    key: "gas",
    label: "الشوفو الغازي",
    fullLabel: "الشوفو بالغاز",
    categorySlug: "gas-water-heater-parts",
    coverSku: "TF-GWH-017",
  },
  {
    key: "electric",
    label: "الشوفو الكهربائي",
    fullLabel: "الشوفو بالكهرباء",
    categorySlug: "electric-water-heater-parts",
    coverSku: "TF-EWH-001",
  },
];

const TITLE = "قطع غيار الشوفو بالجملة";
const DESCRIPTION =
  "قطع غيار سخانات الماء بالغاز والكهرباء — بالجملة للتجار والحرفيين، الدفع عند الاستلام، والتوصيل لجميع مناطق المغرب.";
const SUBTITLE = "سخانات الماء بالغاز · سخانات الماء بالكهرباء";
const AUDIENCE = "بيع بالجملة للتجار والحرفيين";
const HINT = "اختر نوع الشوفو وشوف القطع ديالو.";

/** المخرج لبقية المتجر — بلا الشوفو نفسه، وبمكينات الصابون مكانه. */
const OTHER_CATEGORIES = [
  { href: "/washing-machines", label: "قطع غيار مكينات الصابون" },
  { href: "/category/refrigerator-spare-parts", label: "قطع غيار الثلاجات" },
  { href: "/category/split-ac-parts", label: "المكيفات سبليت" },
  { href: "/category/pressure-cooker-parts", label: "الكوكوط" },
  { href: "/", label: "كل التصنيفات" },
];

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
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const { type } = await searchParams;
  const view = resolveLandingView(HEATER_TABS, type);

  // الدخول من الإعلان بلا `?type=`: بطاقتا الغاز والكهرباء بالتساوي.
  if (view.mode === "overview") {
    return (
      <CampaignOverview
        title={TITLE}
        subtitle={SUBTITLE}
        hint={HINT}
        audience={AUDIENCE}
        basePath={BASE_PATH}
        tabs={HEATER_TABS}
        pageKey="water-heaters"
        typesLabel="أنواع الشوفو"
        otherCategories={OTHER_CATEGORIES}
      />
    );
  }

  // `?type=gas|electric`: التبويب القديم بحرفه، مع طريق رجوع إلى البطاقتين.
  return (
    <CampaignLanding
      title={TITLE}
      subtitle={SUBTITLE}
      hint={HINT}
      basePath={BASE_PATH}
      tabs={HEATER_TABS}
      requestedType={view.tab.key}
      allTypesHref={BASE_PATH}
    />
  );
}
