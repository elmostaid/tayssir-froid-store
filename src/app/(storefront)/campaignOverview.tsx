import Link from "next/link";
import { getProducts, getProductIdsWithVariants, getCategoryProductsByDemand } from "@/lib/queries/catalog";
import type { CatalogProduct } from "@/lib/types";
import { getSettings, getCampaignSections, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { campaignSlotKey } from "@/lib/campaignImages";
import { findSectionSlot, selectSectionProducts, type SectionConfig } from "@/lib/campaignSections";
import { resolveCampaignCardImages } from "@/lib/campaignCardImages";
import { CampaignTypeCards, type CampaignTypeCard } from "@/app/(storefront)/campaignTypeCards";
import { ProductCard } from "@/components/ProductCard";
import { safeQuery } from "@/lib/safeQuery";
import { ServiceUnavailableError } from "@/lib/serviceUnavailable";
import type { CampaignTab } from "@/app/(storefront)/campaignLanding";

/**
 * الوجه المحايد لصفحة الهبوط: التصنيفات كلها متساوية، ولا واحد يُفتح تلقائياً.
 *
 * ## العطل التجاري الذي يُصلحه
 *
 * `CampaignLanding` تفتح `tabs[0]` حين لا يحمل الرابط `?type=`. في حملة
 * الشوفو كان الإعلان يعرض الغازي والكهربائي معاً، لكن الصفحة تفتح الغازي
 * وحده — فأول ما يراه الزائر 24 منتجاً غازياً، والكهربائي زرٌّ صغير فوقها.
 * والنتيجة المقيسة: الغازي 46,011 درهماً مقابل 2,064 للكهربائي (22 ضعفاً)،
 * والعشرون الأوائل بالإيراد كلّهم غازيون. لا نعرف كم من ذلك طلبٌ حقيقي وكم
 * منه أثر الترتيب — وهذا بالضبط ما لا يجوز تكراره في حملة ثلاثة تصنيفات.
 *
 * فمع ثلاثة أنواع يصير الانحياز أثقل: التصنيف الأول يملأ الشاشة، والنوعان
 * الآخران سطرٌ واحد فوقه قد لا يُقرأ. هذا المكوّن يجعل الدخول من الإعلان
 * يعرض **الثلاثة بالتساوي**: نفس الحجم، نفس الشكل، نفس عدد المنتجات
 * المعروضة، وبلا أي نوع «نشط».
 *
 * ## ما هو ليس
 *
 * ليس بديلاً عن `CampaignLanding` بل وجهاً أوّلَ لها: اختيار نوع يذهب إلى
 * `?type=` ويُسلّم للمكوّن القديم بسلوكه كما هو (24 منتجاً + «عرض المزيد»).
 * فالروابط الإعلانية القديمة التي تحمل `?type=` تبقى تعمل بحرفها، وصفحة
 * الشوفو لا تتغيّر إطلاقاً — هي لا تستعمل هذا الملف.
 *
 * وليس نظام منتجات أو سلة جديداً: نفس `getProducts`، نفس `ProductCard`،
 * نفس زرّ الإضافة للسلة، ونفس `CartProvider` في تخطيط `(storefront)`.
 * فالسلة واحدة عبر الأنواع الثلاثة وبقية المتجر، والـCheckout هو نفسه.
 *
 * ## الضغط على قاعدة البيانات
 *
 * ثلاثة تصنيفات × 4 منتجات = 12 منتجاً، لا 182. والاستعلامات الثلاثة
 * تمرّ على نفس الطبقة المُخزَّنة مؤقتاً (60 ثانية بوسم catalog) التي
 * تستعملها صفحة التصنيف، فالزيارات المتتالية ضمن الدقيقة لا تلمس Supabase.
 * وحدّ 4 يصنع مفتاح تخزين صغيراً خاصاً به، فلا يُبطل تخزين صفحة التصنيف
 * ولا تخزين تبويب `?type=`.
 *
 * والعرض المختصر مقصود: صفحة الهبوط تُجيب «شنو كاين؟» في شاشة واحدة، ثم
 * يختار الزائر نوعه فيرى كلّ قطعه. تحميل الثلاثة كاملةً كان سيضع 182 صورة
 * على هاتف بشبكة ضعيفة — أسوأ ما يمكن فعله بزائر إعلان مدفوع.
 */

/** عدد المنتجات المعروضة لكل نوع في الوجه المحايد — متساوٍ للثلاثة. */
export const OVERVIEW_PREVIEW_SIZE = 4;

export type LandingView =
  | { mode: "overview" }
  | { mode: "tab"; tab: CampaignTab };

/**
 * أي وجه نعرض؟ `?type=` صالح → التبويب القديم. أي شيء آخر → المحايد.
 *
 * الفرق عن `resolveTab`: تلك ترجع `tabs[0]` عند الغياب، وهو بالضبط
 * الانحياز الذي نُصلحه. هنا الغياب يعني «لم يختر بعد»، لا «اختار الأول».
 *
 * والقيمة من الرابط لا تصل إلى أي استعلام: نُطابقها على القائمة المكتوبة
 * في الكود ونأخذ `categorySlug` منها. و`?type=a&type=b` يصل مصفوفةً من
 * Next.js — تُرفض كما تُرفض أي قيمة عابثة، فترجع للوجه المحايد بدل أن
 * تُسقط الصفحة أو تُعرض فارغة.
 */
export function resolveLandingView(
  tabs: CampaignTab[],
  requested: string | string[] | undefined
): LandingView {
  if (typeof requested !== "string") return { mode: "overview" };
  const tab = tabs.find((candidate) => candidate.key === requested);
  return tab ? { mode: "tab", tab } : { mode: "overview" };
}

export async function CampaignOverview({
  title,
  subtitle,
  hint,
  basePath,
  tabs,
  pageKey,
  typesLabel,
  audience,
  otherCategories = OVERVIEW_OTHER_CATEGORIES,
}: {
  title: string;
  subtitle: string;
  hint: string;
  /** مسار الصفحة نفسه، لبناء روابط الأنواع. */
  basePath: string;
  tabs: CampaignTab[];
  /** مفتاح الصفحة لصور البطاقات اليدوية (lib/campaignImages.ts). */
  pageKey: "washing-machines" | "water-heaters";
  /** وصف شريط الأنواع لقارئ الشاشة. */
  typesLabel: string;
  /** سطر الجمهور (مثلاً: للتجار والحرفيين) — اختياري. */
  audience?: string;
  otherCategories?: { href: string; label: string }[];
}) {
  // استعلام لكل نوع، متوازية. الحارس لكل واحد على حدة مقصود: عطل تصنيف
  // واحد لا يجوز أن يُخفي النوعين الآخرين — صفحة فيها نوعان أنفع لزائر
  // مدفوع من صفحة عطل كاملة. ونرمي فقط إذا سقطت الثلاثة.
  //
  // صفحة مكينات الصابون: الأقسام «مُنتقاة» — اختيار المدير أولاً ثم الأكثر
  // طلباً بقطعة واحدة من كل صنف (lib/campaignSections.ts). صفحة الشوفو تبقى
  // على سلوكها: أول أربعة بترتيب الكتالوج.
  const curated = Boolean(findSectionSlot(campaignSlotKey(pageKey, tabs[0]?.key ?? "")));
  const [ranked, variantProductIds, settings, sections] = await Promise.all([
    Promise.all(
      tabs.map((tab) =>
        safeQuery<CatalogProduct[] | "SERVICE_UNAVAILABLE">(
          () =>
            curated
              ? getCategoryProductsByDemand(tab.categorySlug)
              : getProducts({ categorySlug: tab.categorySlug, limit: OVERVIEW_PREVIEW_SIZE }),
          "SERVICE_UNAVAILABLE",
          `campaignOverview.getProducts(${tab.key})`
        )
      )
    ),
    safeQuery(
      () => getProductIdsWithVariants(),
      new Set<number>(),
      "campaignOverview.getProductIdsWithVariants"
    ),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "campaignOverview.getSettings"),
    curated
      ? safeQuery(() => getCampaignSections(), {} as SectionConfig, "campaignOverview.getCampaignSections")
      : Promise.resolve({} as SectionConfig),
  ]);

  // صورة العرض الخاصة لكل منتج في قسمه (إن اختارها المدير).
  const displayImages: Map<number, string>[] = tabs.map(() => new Map());
  const previews = ranked.map((list, index) => {
    if (list === "SERVICE_UNAVAILABLE" || !curated) return list;
    const items = selectSectionProducts(list, sections[campaignSlotKey(pageKey, tabs[index].key)]);
    for (const item of items) if (item.displayImage) displayImages[index].set(item.product.id, item.displayImage);
    return items.map((item) => item.product);
  });

  if (previews.every((preview) => preview === "SERVICE_UNAVAILABLE")) {
    throw new ServiceUnavailableError("campaign-overview");
  }

  // صورة كل بطاقة: اليدوية من لوحة الإدارة، وإلا صورة المنتج الممثِّل،
  // وإلا صورة أول منتج في النوع (المنتجات المجلوبة أعلاه، بلا استعلام زائد).
  //
  // في الصفحة المنتقاة لم يعد أول منتج في القسم هو أول منتج في التصنيف،
  // فالبطاقات تجلب صورتها التلقائية بنفسها (أول منتج بترتيب الكتالوج) —
  // فلا تتغيّر صورة أي بطاقة بسبب اختيار منتجات القسم.
  const cardImages = await resolveCampaignCardImages(
    pageKey,
    tabs,
    curated ? undefined : previews.map((preview) => (preview === "SERVICE_UNAVAILABLE" ? null : preview[0] ?? null))
  );
  const cards: CampaignTypeCard[] = tabs.map((tab, index) => ({
    tab,
    href: `${basePath}?type=${tab.key}`,
    imagePath: cardImages[index].path,
    imageSrc: cardImages[index].src,
    isManual: cardImages[index].isManual,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        {title}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>
      {audience && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-turquoise-tint px-3 py-1 text-xs font-bold text-brand-turquoise-dark">
          {audience}
        </p>
      )}
      <p className="mt-2 text-xs text-neutral-500">{hint}</p>

      {/* الأنواع بصورها، متساوية ولا واحد «نشط» — انظر campaignTypeCards.tsx. */}
      <CampaignTypeCards cards={cards} ariaLabel={typesLabel} />

      {/* قسم لكل نوع، بنفس الترتيب ونفس العدد. */}
      {tabs.map((tab, tabIndex) => {
        const preview = previews[tabIndex];
        const products = preview === "SERVICE_UNAVAILABLE" ? [] : preview;
        const typeHref = `${basePath}?type=${tab.key}`;

        return (
          <section key={tab.key} className="mt-8" aria-labelledby={`type-${tab.key}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h2
                id={`type-${tab.key}`}
                className="border-r-4 border-brand-orange pr-3 text-lg font-bold text-neutral-800"
              >
                {tab.fullLabel ?? tab.label}
              </h2>
              <Link
                href={typeHref}
                prefetch={false}
                className="shrink-0 text-xs font-bold text-brand-turquoise-dark underline-offset-2 hover:underline"
              >
                عرض المزيد
              </Link>
            </div>

            {preview === "SERVICE_UNAVAILABLE" ? (
              // لا نكتب «لا توجد منتجات» لعطل قراءة: الفرق بين «ما كاينش»
              // و«ما قدرناش نقرا» هو الفرق بين إخبار الزبون وتضليله.
              <p className="mt-3 text-sm text-neutral-500">
                تعذّر تحميل منتجات هذا النوع حالياً.{" "}
                <Link href={typeHref} prefetch={false} className="font-bold underline">
                  جرّب من هنا
                </Link>
              </p>
            ) : products.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">
                لا توجد منتجات منشورة في هذا النوع حالياً.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    imageUrl={product.primary_image_path}
                    displayImageUrl={displayImages[tabIndex].get(product.id) ?? null}
                    hasVariants={variantProductIds.has(product.id)}
                    whatsappNumber={settings.whatsappNumber}
                    // فوق الطيّة الآن بطاقات الأنواع بصورها (بأولوية)، فصور
                    // المنتجات كلها كسولة — لا تتزاحم معها على أول حزمة.
                    priority={false}
                  />
                ))}
              </div>
            )}

            {/* الزرّ الكبير: مباشرةً بعد آخر منتج، لا فوق القسم.
                الرابط الصغير بجانب العنوان يفيد من يمسح الصفحة بعينه قبل
                النزول، لكن من قرأ المنتجات الأربعة يصل إلى **نهاية** القسم
                لا إلى رأسه — ولو لم يجد هناك مخرجاً واضحاً انتقل إلى
                التصنيف التالي ظانّاً أنه رأى كل شيء، وهي أربعة منتجات من
                عشرات.

                برتقالي: قاعدة الموقع أن البرتقالي لما يتقدّم بالزبون خطوةً
                نحو الشراء. وهو هنا كذلك ولا يكسر حياد الصفحة — الأزرار
                الثلاثة متطابقة تماماً، واحدٌ لكل نوع بنفس الشكل والحجم.

                ويظهر في كل الحالات (منتجات أو قسم فارغ أو تعذُّر قراءة) حتى
                تبقى الأنواع الثلاثة متساوية بصرياً مهما كانت حالة كلٍّ
                منها. */}
            <Link
              href={typeHref}
              prefetch={false}
              className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-orange px-4 text-center text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-orange-dark active:bg-brand-orange-dark"
            >
              عرض جميع قطع غيار {tab.fullLabel ?? tab.label}
            </Link>
          </section>
        );
      })}

      {/* المخرج إلى بقية المتجر — نفس قسم `CampaignLanding` ولنفس السبب:
          السلة واحدة، فمن جاء لقطعة ويحتاج أخرى من تصنيف آخر يجمعهما في
          طلب واحد بدل أن تصير الصفحة طريقاً مسدوداً. */}
      <section className="mt-10 rounded-xl bg-brand-turquoise-tint p-4">
        <h2 className="text-sm font-bold text-neutral-800">كتقلّب على شي حاجة أخرى؟</h2>
        <p className="mt-1 text-xs text-neutral-600">
          كلشي كيتزاد لنفس السلة، وتقدر تكمل طلبية وحدة فيها كل اللي اخترتي.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {otherCategories.map((category) => (
            <Link
              key={category.href}
              href={category.href}
              className="flex min-h-9 items-center rounded-full border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 transition-colors hover:border-brand-turquoise hover:text-brand-turquoise-dark"
            >
              {category.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * روابط ثابتة إلى تصنيفات حقيقية. مكتوبة لا مُستعلَمة — نفس قاعدة
 * `CampaignLanding`: القائمة الكاملة متاحة في القائمة (☰) والصفحة
 * الرئيسية، فلا تستحقّ استعلاماً إضافياً على كل زيارة.
 */
const OVERVIEW_OTHER_CATEGORIES = [
  { href: "/category/refrigerator-spare-parts", label: "قطع غيار الثلاجات" },
  { href: "/category/split-ac-parts", label: "المكيفات سبليت" },
  { href: "/category/gas-water-heater-parts", label: "الشوفو الغازي" },
  { href: "/category/pressure-cooker-parts", label: "الكوكوط" },
  { href: "/", label: "كل التصنيفات" },
];
