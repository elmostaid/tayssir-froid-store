import Link from "next/link";
import { getProducts, getProductIdsWithVariants } from "@/lib/queries/catalog";
import type { CatalogProduct } from "@/lib/types";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { ProductCard } from "@/components/ProductCard";
import { LoadMoreProducts } from "@/components/LoadMoreProducts";
import { safeQuery } from "@/lib/safeQuery";
import { ServiceUnavailableError } from "@/lib/serviceUnavailable";

/**
 * صفحة هبوط إعلانية: تصنيفات موجودة أصلاً، مجموعة تحت عنوان واحد.
 *
 * ## لماذا توجد، ولماذا بهذا الشكل بالذات
 *
 * الإعلان يعرض فيديو عن **نوع جهاز** (مكينة الصابون، الشوفو)، بينما
 * التصنيفات في المتجر مقسّمة حسب **نوع المكينة الفرعي**. فالزبون الآتي من
 * الإعلان كان سيهبط إما على تصنيف واحد لا يرى بقيّته، أو على صفحة عامة
 * يبحث فيها عمّا رآه قبل ثانية. هذه الصفحة تجمع التصنيفات الثلاثة (أو
 * الاثنين) تحت عنوان واحد وأزرار اختيار واضحة.
 *
 * ## ما هي ليست
 *
 * ليست تصنيفاً جديداً ولا نسخةً من المنتجات: لا صفّ واحد يُكتب في قاعدة
 * البيانات، ولا منتج يُنسخ. تقرأ من `catalog_products` عبر **نفس**
 * `getProducts` التي تستعملها صفحة التصنيف، وتعرض **نفس** `ProductCard`
 * بنفس الثمن والكمية الدنيا وزرّ الإضافة للسلة.
 *
 * وليست جزيرة معزولة: هي داخل `(storefront)/` فترث التخطيط المشترك —
 * الترويسة والبحث والقائمة والفوتر و`CartProvider` (سلة واحدة مع كل
 * المتجر) و`AttributionTracker` (الإسناد الإعلاني يبقى عبر التنقّل)
 * وشريط «إتمام الطلب» أسفل الشاشة. لا شيء من ذلك يُعاد بناؤه هنا.
 *
 * ## لماذا التبويب في الرابط لا في حالة العميل
 *
 * ثلاثة تصنيفات = 182 منتجاً. تحميلها كلها لتبديلٍ فوري يعني 182 صورة على
 * هاتف بشبكة ضعيفة — وهو أسوأ ما يمكن فعله بزائر إعلان. فالتبويب
 * `?type=` والخادم يُرسل التصنيف المطلوب وحده: تنقّل RSC بلا إعادة تحميل
 * الصفحة، ونفس تكلفة صفحة تصنيف عادية.
 *
 * و`prefetch={false}` على الأزرار مقصود: الجلب المسبق الافتراضي كان
 * سيطلب التبويبات الثلاثة كلها لمجرّد ظهورها على الشاشة، فيضرب قاعدة
 * البيانات ثلاث مرات لأجل تبويبين قد لا يُفتحان أبداً.
 */

/** حجم الدفعة — نفس حجم صفحة التصنيف، فالسلوك واحد في كل المتجر. */
export const CAMPAIGN_PAGE_SIZE = 24;

export type CampaignTab = {
  /** قيمة `?type=` في الرابط — قصيرة وقابلة للقراءة في روابط الإعلانات. */
  key: string;
  /** نصّ الزرّ في شريط التبويبات: ثلاثة أزرار في صفّ، فالقِصَر شرط. */
  label: string;
  /**
   * الاسم الكامل للنوع، حيث يوجد عرضٌ له: عناوين الوجه المحايد
   * (`campaignOverview.tsx`) وأزراره بعرض الشاشة. يسقط إلى `label` إن غاب.
   *
   * ولماذا حقلان لا واحد: «مكينة الصابون نصف أوتوماتيك» في ثلث عرض شاشة
   * 360px يُقصّ، و«نصف أوتوماتيك» في عنوان قسم كامل يبدو ناقصاً. الاسم
   * الذي يصلح للزرّ ليس الذي يصلح للعنوان.
   */
  fullLabel?: string;
  /** التصنيف الحقيقي في قاعدة البيانات. */
  categorySlug: string;
};

/**
 * التبويب المطلوب، أو الأول عند غياب/فساد القيمة.
 *
 * لا تصل قيمة الرابط إلى الاستعلام أبداً: نُطابقها على القائمة المعرّفة
 * في الكود، ونأخذ `categorySlug` من القائمة لا من الرابط.
 */
export function resolveTab(tabs: CampaignTab[], requested?: string): CampaignTab {
  return tabs.find((tab) => tab.key === requested) ?? tabs[0];
}

export async function CampaignLanding({
  title,
  subtitle,
  hint,
  basePath,
  tabs,
  requestedType,
  allTypesHref,
}: {
  title: string;
  subtitle: string;
  hint: string;
  /** مسار الصفحة نفسه، لبناء روابط التبويبات. */
  basePath: string;
  tabs: CampaignTab[];
  requestedType?: string;
  /**
   * رابط الرجوع إلى وجه محايد يعرض الأنواع كلها بالتساوي (انظر
   * `campaignOverview.tsx`). اختياري: الصفحات التي لا تملك وجهاً محايداً
   * — الشوفو — تتركه فارغاً فلا يظهر شيء ولا يتغيّر سلوكها.
   */
  allTypesHref?: string;
}) {
  const active = resolveTab(tabs, requestedType);

  // ثلاثة استعلامات متوازية — أقلّ من صفحة التصنيف بواحد (العنوان مكتوب
  // في الكود، فلا حاجة لـgetCategoryBySlug). وكلها تمرّ على نفس الطبقة
  // المُخزَّنة مؤقتاً (60 ثانية بوسم catalog)، فالزيارات المتتالية ضمن
  // الدقيقة لا تلمس Supabase إطلاقاً.
  const [products, variantProductIds, settings] = await Promise.all([
    // النوع الصريح مقصود: الحارس "SERVICE_UNAVAILABLE" قيمةٌ ثالثة إلى
    // جانب القائمة، ولا يستنتجها TypeScript من الوسيط وحده (نفس ما تفعله
    // صفحة التصنيف مع getCategoryBySlug).
    safeQuery<CatalogProduct[] | "SERVICE_UNAVAILABLE">(
      () => getProducts({ categorySlug: active.categorySlug, limit: CAMPAIGN_PAGE_SIZE + 1 }),
      "SERVICE_UNAVAILABLE",
      "campaign.getProducts"
    ),
    safeQuery(() => getProductIdsWithVariants(), new Set<number>(), "campaign.getProductIdsWithVariants"),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "campaign.getSettings"),
  ]);

  // نرمي بدل عرض صفحة فارغة: صفحة هبوط إعلانية بلا منتجات تحرق ميزانية
  // الإعلان بصمت. الرمي يُنتج 5xx حقيقياً ويعرض error.tsx — نفس سلوك
  // صفحة التصنيف.
  if (products === "SERVICE_UNAVAILABLE") {
    throw new ServiceUnavailableError("campaign");
  }

  const hasMoreProducts = products.length > CAMPAIGN_PAGE_SIZE;
  const firstPage = hasMoreProducts ? products.slice(0, CAMPAIGN_PAGE_SIZE) : products;

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        {title}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>

      {/* أزرار اختيار النوع. البرتقالي للنشط — نفس قاعدة الموقع: البرتقالي
          لما يتقدّم بالزبون خطوةً نحو الشراء. */}
      <nav aria-label="نوع الجهاز" className="mt-3 flex gap-2">
        {tabs.map((tab) => {
          const isActive = tab.key === active.key;
          return (
            <Link
              key={tab.key}
              href={`${basePath}?type=${tab.key}`}
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-full px-2 text-center text-xs font-bold leading-tight transition-colors sm:text-sm ${
                isActive
                  ? "bg-brand-orange text-white shadow-sm"
                  : "border border-neutral-300 bg-white text-neutral-700 hover:border-brand-orange hover:text-brand-orange"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-neutral-500">{hint}</p>
        {allTypesHref && (
          <Link
            href={allTypesHref}
            prefetch={false}
            className="shrink-0 text-xs font-bold text-brand-turquoise-dark underline-offset-2 hover:underline"
          >
            شوف كل الأنواع
          </Link>
        )}
      </div>

      <p className="mt-3 text-sm text-neutral-500">
        {/* لا نعلن رقماً لا نعرفه — نفس قاعدة صفحة التصنيف. */}
        عرض {firstPage.length} {firstPage.length === 1 ? "منتج" : "منتجات"}
        {hasMoreProducts && <> (وهناك المزيد)</>}
      </p>

      {firstPage.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">
          لا توجد منتجات منشورة في هذا النوع حالياً.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {firstPage.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                imageUrl={product.primary_image_path}
                hasVariants={variantProductIds.has(product.id)}
                whatsappNumber={settings.whatsappNumber}
                // أول صفّ فقط (بطاقتان على الهاتف) يُحمَّل بأولوية؛ الباقي
                // كسولٌ كما في بقية المتجر، فلا تُحمَّل 24 صورة دفعةً
                // واحدة على شبكة ضعيفة. نفس قاعدة «الأكثر طلباً» في
                // الصفحة الرئيسية.
                priority={index < 2}
              />
            ))}
          </div>
          <LoadMoreProducts
            initialOffset={firstPage.length}
            pageSize={CAMPAIGN_PAGE_SIZE}
            initialHasMore={hasMoreProducts}
            filters={{ categorySlug: active.categorySlug }}
            gridClassName="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          />
        </>
      )}

      {/* المخرج إلى بقية المتجر.
          زائر الإعلان يهبط على نوع جهاز واحد، وقد يكون جاء لقطعة ويحتاج
          أخرى من تصنيف آخر — والسلة واحدة فيستطيع جمعهما في طلب واحد.
          بلا هذا القسم تصير الصفحة طريقاً مسدوداً لمن لم يجد قطعته. */}
      <section className="mt-8 rounded-xl bg-brand-turquoise-tint p-4">
        <h2 className="text-sm font-bold text-neutral-800">كتقلّب على شي حاجة أخرى؟</h2>
        <p className="mt-1 text-xs text-neutral-600">
          كلشي كيتزاد لنفس السلة، وتقدر تكمل طلبية وحدة فيها كل اللي اخترتي.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {OTHER_CATEGORIES.map((category) => (
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
 * روابط ثابتة إلى تصنيفات حقيقية موجودة. مكتوبة هنا لا مُستعلَمة: قائمة
 * التصنيفات الكاملة متاحة أصلاً في القائمة (☰) وفي الصفحة الرئيسية، وهذه
 * اختصارٌ لأكثرها طلباً — فلا تستحقّ استعلاماً إضافياً على كل زيارة.
 */
const OTHER_CATEGORIES = [
  { href: "/category/refrigerator-spare-parts", label: "قطع غيار الثلاجات" },
  { href: "/category/split-ac-parts", label: "المكيفات سبليت" },
  { href: "/category/electric-oven-parts", label: "الفرن الكهربائي" },
  { href: "/category/pressure-cooker-parts", label: "الكوكوط" },
  { href: "/", label: "كل التصنيفات" },
];
