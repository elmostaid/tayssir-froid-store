import Link from "next/link";
import { getProducts, getProductIdsWithVariants } from "@/lib/queries/catalog";
import type { CatalogProduct } from "@/lib/types";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
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
}: {
  title: string;
  subtitle: string;
  hint: string;
  /** مسار الصفحة نفسه، لبناء روابط الأنواع. */
  basePath: string;
  tabs: CampaignTab[];
}) {
  // استعلام لكل نوع، متوازية. الحارس لكل واحد على حدة مقصود: عطل تصنيف
  // واحد لا يجوز أن يُخفي النوعين الآخرين — صفحة فيها نوعان أنفع لزائر
  // مدفوع من صفحة عطل كاملة. ونرمي فقط إذا سقطت الثلاثة.
  const [previews, variantProductIds, settings] = await Promise.all([
    Promise.all(
      tabs.map((tab) =>
        safeQuery<CatalogProduct[] | "SERVICE_UNAVAILABLE">(
          () => getProducts({ categorySlug: tab.categorySlug, limit: OVERVIEW_PREVIEW_SIZE }),
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
  ]);

  if (previews.every((preview) => preview === "SERVICE_UNAVAILABLE")) {
    throw new ServiceUnavailableError("campaign-overview");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        {title}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>
      <p className="mt-1 text-xs text-neutral-500">{hint}</p>

      {/* الاختيارات الثلاثة: عمود واحد على الهاتف وثلاثة أعمدة من sm.
          العمود على الهاتف ليس تنازلاً عن التساوي بل شرطه — «نصف
          أوتوماتيك» في ثلث عرض شاشة 360px يُقصّ أو يصغر خطّه، فيبدو
          الاختيار الأوسط أضعف من جاره. وبالعمود تأخذ الثلاثة نفس العرض
          الكامل ونفس الخط.

          ولا نوع «نشط» هنا: الثلاثة بنفس الحدود ونفس الخلفية، فلا شيء
          بصريٌّ يقول للزائر إن أحدها هو المقصود. */}
      <nav aria-label="أنواع مكينات الصابون" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`${basePath}?type=${tab.key}`}
            prefetch={false}
            className="flex min-h-12 items-center justify-between gap-2 rounded-xl border-2 border-brand-turquoise bg-white px-4 text-sm font-bold text-neutral-800 transition-colors hover:bg-brand-turquoise-tint active:bg-brand-turquoise-tint sm:justify-center sm:text-center"
          >
            <span>{tab.fullLabel ?? tab.label}</span>
            {/* سهم لجهة اليسار: الصفحة RTL، فاتجاه التقدّم يساراً. */}
            <span aria-hidden="true" className="text-brand-turquoise-dark sm:hidden">
              ←
            </span>
          </Link>
        ))}
      </nav>

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
                {products.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    imageUrl={product.primary_image_path}
                    hasVariants={variantProductIds.has(product.id)}
                    whatsappNumber={settings.whatsappNumber}
                    // أول بطاقتين من أول نوع وحدهما فوق الطيّة. لو أعطينا
                    // الأولوية لأول بطاقتين من كل نوع لصارت ست صور بأولوية،
                    // فتتزاحم على نفس الحزمة وتتأخّر كلها.
                    priority={tabIndex === 0 && index < 2}
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
          {OVERVIEW_OTHER_CATEGORIES.map((category) => (
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
