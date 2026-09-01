import Image from "next/image";
import Link from "next/link";
import {
  getCategoryCoverImages,
  getFeaturedProducts,
  getFilteredCategories,
  getProductCountsByCategory,
  getProductIdsWithVariants,
  getProducts,
  getProductsBySkus,
} from "@/lib/queries/catalog";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { ProductCard } from "@/components/ProductCard";
import { CategoryIcon } from "@/components/CategoryIcon";
import { HowToOrder } from "@/components/HowToOrder";
import { LoadMoreProducts } from "@/components/LoadMoreProducts";
import { getCategoryImage } from "@/lib/categoryImages";
import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";
import { TOP_DEMAND_SKUS } from "@/lib/catalog/topDemand";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { safeQuery } from "@/lib/safeQuery";

// تُعرض هذه الصفحة ديناميكياً عند كل طلب (وليس عند البناء) لأن بيانات
// المنتجات والأسعار تأتي من قاعدة البيانات ويجب أن تكون محدَّثة دائماً.
export const dynamic = "force-dynamic";

// حُذف «الحد الأدنى للطلب: 1000 درهم» من هنا مع حذف الحاجز نفسه.
//
// وما حلّ محلّه ليس «اطلب أي كمية — بلا حد أدنى»: تلك الجملة كانت ستكذب
// على الزبون، فالكمية الدنيا لكل منتج ما زالت قائمة (فيس فراكة أدناه 10
// قطع مثلاً)، وكان سيصطدم بها بعد أن وعدناه بحرية مطلقة. الصياغة الحالية
// تحفظ هوية الجملة وتقول الحقيقة كما هي: لا شرط مالي عام، والقيد الوحيد
// الباقي هو كمية كل منتج على حدة.
export function buildTrustPoints(): string[] {
  return [
    "أثمنة مناسبة للتجار والصنايعية — الكمية الدنيا تختلف حسب المنتوج",
    "الدفع عند الاستلام بعد معاينة السلعة",
    "التوصيل لجميع مدن المغرب 24–48 ساعة",
    "كلما زادت الكمية، كينقص الثمن",
  ];
}

// حجم الدفعة الواحدة في شبكة "جميع المنتجات" بالصفحة الرئيسية.
export const HOME_PAGE_SIZE = 16;

// ترتيب ثابت مطلوب لقسم التصنيفات فالصفحة الرئيسية: الثلاجات، ثم المكيفات
// سبليت، ثم الغسالات العادية. أي تصنيف آخر (لو ظهر مستقبلاً) يبقى بعدها
// بنفس ترتيبه الأصلي من getFilteredCategories.
const HOME_CATEGORY_ORDER = [
  "refrigerator-spare-parts",
  "split-ac-parts",
  "standard-washing-machine-parts",
];

function sortHomeCategories<T extends { slug: string }>(categories: T[]): T[] {
  return categories.slice().sort((a, b) => {
    const indexA = HOME_CATEGORY_ORDER.indexOf(a.slug);
    const indexB = HOME_CATEGORY_ORDER.indexOf(b.slug);
    const rankA = indexA === -1 ? HOME_CATEGORY_ORDER.length : indexA;
    const rankB = indexB === -1 ? HOME_CATEGORY_ORDER.length : indexB;
    return rankA - rankB;
  });
}

export default async function HomePage() {
  const [
    categoriesRaw,
    productCounts,
    categoryCovers,
    products,
    featured,
    measuredTopDemand,
    variantProductIds,
    settings,
  ] = await Promise.all([
    getFilteredCategories("home.getCategories"),
    safeQuery(() => getProductCountsByCategory(), {}, "home.getProductCountsByCategory"),
    // غلاف لكل تصنيف بلا صورة مصمَّمة — من أول منتج فيه بترتيب المدير.
    safeQuery(() => getCategoryCoverImages(), {}, "home.getCategoryCoverImages"),
    // نطلب عنصراً زائداً واحداً لنعرف هل توجد دفعة تالية، بدل استعلام عدّ
    // منفصل. الزائد يُقتطع قبل العرض.
    safeQuery(() => getProducts({ limit: HOME_PAGE_SIZE + 1 }), [], "home.getProducts"),
    // «الأكثر طلباً» — اختيار صاحب المتجر أولاً، والقياس احتياطاً.
    safeQuery(() => getFeaturedProducts(), [], "home.getFeaturedProducts"),
    safeQuery(() => getProductsBySkus([...TOP_DEMAND_SKUS]), [], "home.getTopDemand"),
    safeQuery(() => getProductIdsWithVariants(), new Set<number>(), "home.getProductIdsWithVariants"),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "home.getSettings"),
  ]);

  const categories = sortHomeCategories(categoriesRaw);

  // الاختيار اليدوي من /admin/featured يفوز كاملاً حين يوجد؛ القائمة
  // المقاسة (topDemand.ts) احتياط لا شريك — لا خلط بين المصدرين، وإلا لم
  // يعد المدير يعرف لماذا ظهر منتج لم يخترْه.
  const topDemand = featured.length > 0 ? featured : measuredTopDemand;

  // مسارات التخزين تُحلّ إلى روابط عرض دفعة واحدة (نفس ما تفعله ProductCard
  // لكل بطاقة على حدة) — التصنيفات ذات الصورة المصمَّمة لا تحتاج شيئاً.
  const coverUrlByPath = await resolveProductImageUrls(
    categories
      .filter((category) => !getCategoryImage(category.slug))
      .map((category) => categoryCovers[category.slug])
      .filter((path): path is string => Boolean(path))
  );

  // الصفحة الرئيسية تعرض الآن كل التصنيفات معاً (للزبون الذي يفضّل التصفّح
  // بلا دخول لتصنيف)، لكن على دفعات: أول HOME_PAGE_SIZE منتجاً فقط تُصيَّر مع
  // الصفحة، والباقي عند الطلب. تحميل الكتالوج كله دفعة واحدة كان سيُثقل
  // الصفحة على الهاتف ويكبّر HTML بلا داعٍ.
  const hasMoreProducts = products.length > HOME_PAGE_SIZE;
  const firstPage = hasMoreProducts ? products.slice(0, HOME_PAGE_SIZE) : products;

  const whatsappLink = buildWhatsAppLink(
    settings.whatsappNumber,
    "مرحباً، أريد الاطلاع على منتجاتكم بالجملة."
  );
  const trustPoints = buildTrustPoints();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <section className="rounded-2xl bg-brand-turquoise-tint px-5 py-8">
        <span className="inline-block rounded-full bg-brand-orange px-3 py-1 text-xs font-semibold text-white">
          البيع بالجملة فقط
        </span>
        <h1 className="mt-3 text-2xl font-bold text-neutral-900 sm:text-3xl">
          قطع الغيار بالجملة
        </h1>

        <ul className="mt-4 flex flex-col gap-1.5 text-sm text-neutral-700 sm:text-base">
          {trustPoints.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-turquoise" />
              {point}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <Link
            href="#categories"
            className="flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark"
          >
            تصفح المنتجات
          </Link>
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-whatsapp px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-whatsapp-dark"
          >
            محتاج مساعدة؟ طلب عبر واتساب
          </a>
        </div>
      </section>

      {/* الأكثر طلباً — أول ما يراه الزائر بعد الهيرو مباشرة.
          *
          السبب بالأرقام: 1,557 من 2,068 زائراً هبطوا على هذه الصفحة (75.3%)
          غادروا بلا أي تفاعل — لا فتح منتج ولا إضافة للسلة. والصفحة كانت
          تضع 13 بطاقة تصنيف بنسبة 4:5 وعرض الشاشة كاملاً قبل أول منتج، أي
          نحو تسع شاشات هاتف من التمرير قبل أن يرى الزائر سلعة واحدة بثمنها.
          الزائر الآتي من ريل عن غاز الثلاجات كان يرى نصاً ووعوداً، ولا يرى
          غازاً. */}
      {topDemand.length > 0 && (
        <section className="mt-6">
          <h2 className="border-r-4 border-brand-orange pr-3 text-lg font-bold text-neutral-800">
            الأكثر طلباً
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {topDemand.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                imageUrl={product.primary_image_path}
                hasVariants={variantProductIds.has(product.id)}
                whatsappNumber={settings.whatsappNumber}
                // أول صفّ فقط: هو ما يقع فوق الطيّة على الهاتف.
                priority={index < 2}
              />
            ))}
          </div>
        </section>
      )}

      {/* شرح طريقة الطلب. مكوّن خادم بلا JavaScript ولا صور، فلا أثر له على
          زمن التحميل. */}
      <HowToOrder />

      {categories.length > 0 && (
        <section id="categories" className="mt-8 scroll-mt-20">
          <h2 className="border-r-4 border-brand-turquoise pr-3 text-lg font-bold text-neutral-800">
            التصنيفات
          </h2>
          {/* عمودان بدل بطاقة واحدة بعرض الشاشة لكل تصنيف: الثلاثة عشر
              تصنيفاً كانت تُنتج نحو 6,240 بكسل من الصور على هاتف بعرض 384،
              أي تمريراً خالصاً يفصل الزائر عن المنتجات. عمودان يُنزلانها إلى
              نحو 1,800 — ولا ننزل إلى ثلاثة أعمدة لأن اسم التصنيف مطبوع
              داخل الصورة نفسها، وعرض 118 بكسل يجعله غير مقروء. */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {categories.map((category) => {
              const count = productCounts[category.id] ?? 0;
              // صورة مصمَّمة للتصنيف إن وُجدت، وإلا غلاف من منتجاته هو.
              // الفرق ليس شكلياً: الصور المصمَّمة تحمل اسم التصنيف مطبوعاً
              // داخلها، وصور المنتجات لا — فهذه وحدها تحتاج الاسم نصاً.
              const brandedSrc = getCategoryImage(category.slug);
              const coverPath = brandedSrc ? null : categoryCovers[category.slug];
              const coverSrc = coverPath ? coverUrlByPath[coverPath] ?? null : null;
              const imageSrc = brandedSrc ?? coverSrc;
              return (
                <Link
                  key={category.id}
                  href={`/category/${category.slug}`}
                  className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition-colors hover:border-brand-turquoise"
                >
                  <span className="relative block aspect-[4/5] w-full bg-neutral-50">
                    {imageSrc ? (
                      // الصورة نفسها تحتوي على اسم التصنيف مطبوعاً فأسفلها
                      // (مصمَّمة هكذا مسبقاً) — لا نكرّر الاسم فنص HTML فوقها
                      // تفادياً للتكرار البصري، ونكتفي بعدد المنتجات تحتها.
                      <Image
                        src={imageSrc}
                        alt={category.name_ar}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1152px) 33vw, 280px"
                        className="object-contain object-center p-2"
                        // التصنيفات نزلت تحت قسم «الأكثر طلباً»، فلا تظهر
                        // منها بطاقة فوق الطيّة أصلاً. حجزها بـpriority كان
                        // سيُنزِّل ثلاث عشرة صورة بأولوية قصوى قبل JavaScript
                        // نفسه — وهو ما كان يؤخّر أول عرض وأول حدث Meta على
                        // الشبكات الضعيفة.
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-turquoise-tint text-brand-turquoise-dark">
                          <CategoryIcon slug={category.slug} name={category.name_ar} className="h-7 w-7" />
                        </span>
                        <span className="line-clamp-2 text-center text-sm font-semibold text-neutral-800">
                          {category.name_ar}
                        </span>
                      </span>
                    )}
                  </span>
                  {coverSrc && (
                    <span className="line-clamp-2 px-2 pt-2 text-center text-sm font-semibold text-neutral-800">
                      {category.name_ar}
                    </span>
                  )}
                  <span className="px-3 py-2 text-center text-xs text-neutral-500">
                    {count} {count === 1 ? "منتج" : "منتجات"}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="border-r-4 border-brand-turquoise pr-3 text-lg font-bold text-neutral-800">
          جميع المنتجات
        </h2>
        {firstPage.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            لا توجد منتجات منشورة بعد.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {firstPage.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  imageUrl={product.primary_image_path}
                  hasVariants={variantProductIds.has(product.id)}
                  whatsappNumber={settings.whatsappNumber}
                />
              ))}
            </div>
            <LoadMoreProducts
              initialOffset={firstPage.length}
              pageSize={HOME_PAGE_SIZE}
              initialHasMore={hasMoreProducts}
            />
          </>
        )}
      </section>
    </div>
  );
}
