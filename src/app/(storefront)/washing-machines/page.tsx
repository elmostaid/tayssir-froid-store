import type { Metadata } from "next";
import { CampaignLanding, type CampaignTab } from "@/app/(storefront)/campaignLanding";
import { CampaignOverview, resolveLandingView } from "@/app/(storefront)/campaignOverview";
import { getSiteUrl } from "@/lib/siteUrl";

// الأثمنة والمخزون من قاعدة البيانات، فلا تُخزَّن الصفحة مُصيَّرةً.
export const dynamic = "force-dynamic";

const BASE_PATH = "/washing-machines";

/**
 * الترتيب هنا ترتيب **عرضٍ** لا أفضلية، ولم يبق أحدها افتراضياً.
 *
 * كان التعليق السابق يبرّر «العادية أولاً» بأنها 94% من إيراد مكينات
 * الصابون (89,363 درهماً من 55 طلباً، مقابل 3,215 للأوتوماتيك و1,905 لنصف
 * الأوتوماتيك). والرقم صحيح، لكنه **لا يصلح مبرّراً لصفحة هبوط إعلانية**:
 * تلك المبيعات جاءت من متجر كانت العادية فيه هي ما يُفتح أولاً، فالرقم
 * يقيس الطلب والترتيب مخلوطين ولا يفصل بينهما.
 *
 * وحملة الشوفو أرتنا الثمن: الإعلان عرض الغازي والكهربائي، والصفحة فتحت
 * الغازي، والنتيجة 46,011 درهماً غازياً مقابل 2,064 كهربائياً. لذلك الدخول
 * من الإعلان صار يعرض الأنواع الثلاثة بالتساوي (انظر `campaignOverview.tsx`)،
 * والترتيب هنا لم يتغيّر فقط لتبقى الروابط والاختبارات القديمة على حالها.
 */
export const WASHING_TABS: CampaignTab[] = [
  {
    key: "standard",
    label: "العادية",
    fullLabel: "مكينة الصابون العادية",
    categorySlug: "standard-washing-machine-parts",
  },
  {
    key: "semi",
    label: "نصف أوتوماتيك",
    fullLabel: "مكينة الصابون نصف أوتوماتيك",
    categorySlug: "semi-automatic-washing-machine-parts",
  },
  {
    key: "automatic",
    label: "أوتوماتيك",
    fullLabel: "مكينة الصابون أوتوماتيك",
    categorySlug: "automatic-washing-machine-parts",
  },
];

const TITLE = "قطع غيار مكينات الصابون بالجملة";
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
  // مصفوفة واردة فعلاً من Next.js عند `?type=a&type=b`. النوع يقولها بدل
  // أن تُكذِّبه الحقيقة، و`resolveLandingView` يرفضها إلى الوجه المحايد.
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const { type } = await searchParams;
  const view = resolveLandingView(WASHING_TABS, type);

  // لا `?type=` صالح — أي الدخول المباشر من الإعلان: الأنواع الثلاثة
  // بالتساوي، ولا واحد يُفتح فيُخفي الآخرين.
  if (view.mode === "overview") {
    return (
      <CampaignOverview
        title={TITLE}
        subtitle="العادية · نصف أوتوماتيك · أوتوماتيك — بالقطعة والجملة"
        hint="اختر نوع المكينة ديالك وشوف القطع المناسبة ليها."
        basePath={BASE_PATH}
        tabs={WASHING_TABS}
      />
    );
  }

  // `?type=` صالح: السلوك القديم بحرفه — 24 منتجاً و«عرض المزيد» — فالروابط
  // الإعلانية والتبويبات السابقة لا تتعطّل. و`allTypesHref` هو طريق الرجوع
  // إلى الوجه المحايد.
  return (
    <CampaignLanding
      title={TITLE}
      subtitle="العادية · نصف أوتوماتيك · أوتوماتيك — بالقطعة والجملة"
      hint="اختر نوع المكينة ديالك وشوف القطع المناسبة ليها."
      basePath={BASE_PATH}
      tabs={WASHING_TABS}
      requestedType={view.tab.key}
      allTypesHref={BASE_PATH}
    />
  );
}
