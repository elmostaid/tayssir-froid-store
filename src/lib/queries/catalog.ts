import { cache } from "react";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { safeQuery } from "@/lib/safeQuery";
import { ServiceUnavailableError } from "@/lib/serviceUnavailable";
import {
  CATALOG_TAG,
  CATALOG_REVALIDATE_SECONDS,
  isMissingCacheContext,
} from "@/lib/queries/catalogCache";
import type {
  Category,
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductImage,
} from "@/lib/types";
import {
  getPreviewCategories,
  getPreviewCategoryBySlug,
  getPreviewProducts,
  getPreviewProductBySlug,
  getPreviewProductVariants,
  getPreviewProductImages,
  searchPreviewProducts,
  getPreviewProductCountsByCategory,
  getPreviewProductIdsWithVariants,
  type ProductSort,
} from "@/lib/previewCatalog";

export type { ProductSort };

// كل الاستعلامات هنا تقرأ من views عامة (catalog_*) لا تحتوي أبداً على
// عمود ثمن الشراء السري، ولا تعرض إلا المنتجات المنشورة والتصنيفات الفعالة.
//
// بدون DATABASE_URL (مثلاً عند النشر على Vercel بدون قاعدة بيانات حقيقية)،
// تُستعمل نفس بيانات المنتجات والصور المحلية المستعملة في /preview بدل
// الاتصال بقاعدة البيانات.
//
// مهم: DATABASE_URL قد يكون معرَّفاً (مشروع Supabase حقيقي مربوط) لكن تلك
// القاعدة لم تُطبَّق عليها migrations المشروع بعد (views مثل catalog_products
// غير موجودة أصلاً)، أو مُطبَّقة لكن لا تحتوي على أي منتج منشور بعد. الحالة
// الأولى تُسقط الاستعلام بخطأ حقيقي، والثانية تُرجع نتيجة فارغة بنجاح —
// وكلتاهما تنتج نفس العرض المكسور "لا توجد منتجات منشورة بعد". لهذا كل دالة
// هنا تتراجع إلى بيانات /preview المحلية في الحالتين معاً: فشل الاستعلام
// فعلياً، أو نجاحه بنتيجة فارغة. هذا إجراء وقائي **مؤقت** على فرع
// product-updates-preview فقط (لا يُطبَّق على main) ريثما يتم إعداد وترحيل
// (migrate) قاعدة Supabase الحقيقية بشكل كامل — يجب إعادة تقييمه أو تضييقه
// قبل أي استعمال إنتاجي حقيقي، لأن نتيجة فارغة قد تكون صحيحة فعلاً (بحث
// بدون نتائج مطابقة، تصنيف فارغ مؤقتاً). كل تراجع يُسجَّل في logs بسببه
// الدقيق (خطأ فعلي أو نتيجة فارغة) لتسهيل تتبع حالة القاعدة الحقيقية.
// نفس نمط معالجة الأخطاء مُطبَّق سابقاً في catalogExport.ts لملف Meta
// Commerce Catalog.

const hasDatabase = Boolean(process.env.DATABASE_URL);

// cache() من React يُلغي التكرار داخل **الطلب الواحد** فقط — كل زائر جديد
// كان يُعيد تنفيذ كل استعلامات الكتالوج من الصفر. مع صفحات force-dynamic
// (وهي ضرورية هنا لأن صفحات التصنيف والبحث تقرأ searchParams)، هذا يعني أن
// كل زيارة تفتح رحلة كاملة إلى قاعدة البيانات عبر الشبكة.
//
// unstable_cache يُخزِّن النتيجة **عبر الطلبات** وعلى مستوى الخادم كله، مع
// وسم يُبطله فوراً عند أي تعديل من الإدارة (revalidateCatalog). النتيجة أن
// موجة زيارات مفاجئة تُخدَّم كلها من الذاكرة باستعلام واحد فعلي بدل استعلام
// لكل زائر — وهو ما يحمي سقف الاتصالات (60) من الامتلاء أصلاً بدل الاعتماد
// على الإلغاء في db.ts كخط دفاع أخير.
//
// ملاحظة توثيقية: Next.js 16 يوصي بـ`use cache` مع Cache Components بدل
// unstable_cache. لم نُفعِّل cacheComponents لأنه يُغيِّر نموذج التخزين
// المؤقّت للتطبيق كله ويحوِّل كل بيانات ديناميكية غير مُخزَّنة إلى أخطاء —
// هجرة تخصّها دورة عمل واختبار مستقلة. توثيق Next.js نفسه ينصّ على أن
// unstable_cache يبقى يعمل كطبقة مستقلة، وهو المسار الموثَّق رسمياً
// للمشاريع التي لم تُفعِّل Cache Components بعد.
function cachedCatalogQuery<Args extends unknown[], Result>(
  keyParts: string[],
  run: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  const cached = unstable_cache(run, keyParts, {
    tags: [CATALOG_TAG],
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });

  return async (...args: Args): Promise<Result> => {
    try {
      return await cached(...args);
    } catch (error) {
      // خارج سياق Next.js (اختبارات، سكريبتات tsx) لا يوجد مخزن مؤقّت أصلاً —
      // ننفّذ الاستعلام مباشرة. أي خطأ آخر (فشل قاعدة بيانات حقيقي) يُعاد
      // رميه ليلتقطه catch الموجود في الدالة المُستدعِية فتتراجع للبيانات
      // الاحتياطية كما كان مصمَّماً.
      if (isMissingCacheContext(error)) return run(...args);
      throw error;
    }
  };
}

// ⚠️ تغيير مقصود بعد عطل 16 غشت: كان أي فشل استعلام هنا يُرجع بيانات
// /preview التجريبية بصمت وبرمز HTTP 200. تحقّقنا من الأثر عملياً بقاعدة
// بيانات ميتة تماماً: الصفحة ردّت 200 بـ421 كيلوبايت و71 منتجاً، **كلها**
// من src/lib/data/preview/products.json — أي أن الزبون كان يتصفّح منتجات
// وأثماناً تجريبية ويمكنه أن يطلب عليها، بينما كل فحص توفّر يرى الموقع
// سليماً. تعليق هذا الملف نفسه كان ينصّ على أن التراجع إجراء **مؤقّت** يجب
// تضييقه قبل أي استعمال إنتاجي حقيقي — وهذا هو التضييق.
//
// الآن: مع DATABASE_URL مضبوط، فشل الاستعلام فشلٌ حقيقي يُرمى فتُرجع الصفحة
// 5xx وتعرض error.tsx. التراجع لبيانات /preview يبقى فقط حين لا يوجد
// DATABASE_URL إطلاقاً (نشر تجريبي/عرض بلا قاعدة) — وهو الفحص المُبكِّر في
// أول كل دالة أدناه، فلا يصل التنفيذ إلى هنا أصلاً في تلك الحالة.
function failQuery(context: string, error: unknown): never {
  console.error(
    `catalog.ts (${context}): فشل الاستعلام على قاعدة البيانات الحقيقية`,
    error
  );
  throw new ServiceUnavailableError(context);
}

// نتيجة فارغة ليست فشلاً: تصنيف بلا منتجات، أو بحث بلا نتائج، حالات صحيحة
// وشائعة. كانت تُستبدَل ببيانات تجريبية، فيرى الزبون منتجات غير موجودة
// فعلاً. الآن تُسجَّل فقط وتُعاد النتيجة الفارغة كما هي.
function logEmptyResult(context: string) {
  console.warn(
    `catalog.ts (${context}): الاستعلام نجح وأعاد صفر نتائج`
  );
}

// مُغلَّفة بـcache() (تخزين مؤقَّت لعمر الطلب الواحد فقط من React) لأن
// SiteHeader والصفحة الرئيسية (وSitemap) يستدعونها كلهم فنفس عرض الصفحة
// الواحدة — بدون هذا، كل عرض صفحة واحد كان يُنفِّذ نفس استعلام التصنيفات
// مرتين فعلياً (مرة من SiteHeader المشترك، ومرة أخرى من الصفحة نفسها)،
// يضاعف عدد الاتصالات/الاستعلامات المتزامنة اللازمة لكل زيارة بلا أي فائدة
// — هذا أحد أسباب تراكم التأخير عند تدهور قاعدة البيانات (انظر التعليق
// الكامل فـdb.ts عن statement_timeout للسبب الجذري الأساسي). لا تأثير على
// دقة البيانات: نفس النتيجة بالضبط، فقط استعلام واحد فعلي بدل عدة.
const queryCategories = cachedCatalogQuery(["catalog-categories"], async () => {
  return sql<Category[]>`
    select c.id, c.slug, c.name_ar, c.name_fr, c.description_ar, c.parent_id, c.sort_order
    from public.catalog_categories c
    where exists (
      select 1 from public.catalog_products p where p.category_id = c.id
    )
    order by c.sort_order asc, c.name_ar asc
  `;
});

export const getCategories = cache(async (): Promise<Category[]> => {
  if (!hasDatabase) return getPreviewCategories();

  try {
    // نُخفي عن الزبون أي تصنيف بلا أي منتج ظاهر حالياً (المنتجات المحذوفة أو
    // غير المنشورة أصلاً لا تصل حتى إلى catalog_products)، بدون حذف التصنيف
    // نفسه من قاعدة البيانات — يبقى التصنيف موجوداً في لوحة الإدارة ويظهر
    // للزبون تلقائياً بمجرد نشر أول منتج فيه.
    const rows = await queryCategories();
    if (rows.length === 0) {
      logEmptyResult("getCategories");
    }
    return rows;
  } catch (error) {
    failQuery("getCategories", error);
  }
});

// المصدر الوحيد لقائمة التصنيفات الظاهرة للزبون فأي مكان فالموقع (رأس
// الصفحة على الحاسوب والهاتف، الصفحة الرئيسية، وأي قائمة تصنيفات عامة
// مستقبلية) — يجب استعمال هذه الدالة فقط، وليس getCategories() مباشرة، حتى
// يبقى مصدر الفلترة موحَّداً فمكان واحد بدل تكراره فكل صفحة. getCategories()
// نفسها تُخفي أصلاً أي تصنيف بلا منتج منشور واحد على الأقل، ديناميكياً من
// المنتجات الحالية (وليس بأسماء تصنيفات مكتوبة يدوياً) — إضافة أول منتج
// منشور لتصنيف تُظهره تلقائياً بلا أي تعديل هنا. لا تُستعمل فلوحة الإدارة
// (اللي يجب أن تعرض كل التصنيفات، حتى الفارغة، للإدارة).
export async function getFilteredCategories(context: string): Promise<Category[]> {
  return safeQuery(() => getCategories(), [], context);
}

// مُغلَّفة بـcache() لأن صفحة التصنيف تستدعيها مرتين فعلياً فنفس الطلب —
// مرة من generateMetadata() ومرة من مكوّن الصفحة نفسه (سلوك عادي فـNext.js
// App Router: لا تجميع تلقائي بين الاثنين لاستدعاءات SQL مباشرة كما يحدث
// مع fetch()) — بدون هذا كانت كل زيارة لصفحة تصنيف تُنفِّذ نفس الاستعلام
// مرتين. نفس النتيجة بالضبط، فقط استعلام واحد فعلي بدل اثنين.
const queryCategoryBySlug = cachedCatalogQuery(
  ["catalog-category-by-slug"],
  async (slug: string) => {
    return sql<Category[]>`
      select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order
      from public.catalog_categories
      where slug = ${slug}
      limit 1
    `;
  }
);

export const getCategoryBySlug = cache(async (slug: string): Promise<Category | null> => {
  if (!hasDatabase) return getPreviewCategoryBySlug(slug);

  try {
    const rows = await queryCategoryBySlug(slug);
    if (rows.length === 0) {
      logEmptyResult(`getCategoryBySlug(${slug})`);
    }
    return rows[0];
  } catch (error) {
    failQuery("getCategoryBySlug", error);
  }
});

async function runProductsQuery(
  categorySlug: string | null,
  limit: number,
  sort: ProductSort,
  pattern: string | null,
  offset: number
): Promise<CatalogProduct[]> {
  // الترتيب الافتراضي ("الأحدث"): ترتيب المدير اليدوي — لا ترتيب إداري خفي.
  //
  // **لماذا انضمّ ترتيب التصنيف إلى المفتاح.** sort_order للمنتج رقم *داخل
  // تصنيفه فقط*: moveProductToRank يُعيد ترقيم التصنيف 1..N بعد كل نقل،
  // والقياس على الإنتاج يؤكّده — ثمانية تصنيفات فيها منتجات، كل واحد
  // مُرقَّم 1..N على حدة (23 و8 و18 و91 و53 و44 و48 و23 قيمة متمايزة).
  // فالترتيب بـsort_order وحده على قائمة غير مفلترة بتصنيف («جميع
  // المنتجات» فالصفحة الرئيسية) كان يخلط ثمانية منتجات مختلفة كلها تحمل
  // الرقم 1، ثم ثمانية تحمل 2… أي أن المدير يضع منتجاً فالمرتبة 1 فلا يراه
  // أولاً، بل وسط سبعة آخرين. الرقم كان يُطبَّق فعلاً، لكن مقارنة أرقام من
  // تصنيفات مختلفة ببعضها لا معنى لها.
  //
  // الحل: ترتيب التصنيفات أولاً (نفس sort_order الذي يضبطه المدير فـ
  // /admin/categories وهو نفسه ترتيب قسم التصنيفات المعروض للزبون)، ثم
  // ترتيب المنتج داخل تصنيفه. فصفحة التصنيف لا يتغيّر فيها شيء (تصنيف
  // واحد)، و«جميع المنتجات» تصير تصنيفاً بعد تصنيف بترتيب المدير الفعلي.
  // created_at تنازلياً يبقى fallback ثابتاً عند تساوي الرقم (منتج جديد لم
  // يُرتَّب يدوياً بعد).
  const orderBy =
    sort === "price_asc"
      ? sql`order by p.sale_price asc`
      : sort === "price_desc"
        ? sql`order by p.sale_price desc`
        : sort === "name"
          ? sql`order by p.name_ar asc`
          : sql`order by c.sort_order asc nulls last, p.sort_order asc, p.created_at desc`;

  // LEFT JOIN لا INNER: catalog_products يشترط أصلاً أن يكون التصنيف فعّالاً
  // فالمطابقة مضمونة اليوم، لكن الربط الخارجي يضمن ألا يختفي منتج من المتجر
  // بصمت لو تغيّر تعريف أيٍّ من العرضين لاحقاً — يتأخّر ترتيبه ولا يسقط.
  return sql<CatalogProduct[]>`
    select p.* from public.catalog_products p
    left join public.catalog_categories c on c.id = p.category_id
    where (${categorySlug}::text is null or p.category_slug = ${categorySlug})
      and (
        ${pattern}::text is null
        or p.name_ar ilike ${pattern}
        or p.name_fr ilike ${pattern}
        or p.sku ilike ${pattern}
        or p.description_ar ilike ${pattern}
      )
    ${orderBy}
    limit ${limit}
    offset ${offset}
  `;
}

const queryProductsCached = cachedCatalogQuery(
  ["catalog-products"],
  async (categorySlug: string | null, limit: number, sort: ProductSort, offset: number) =>
    runProductsQuery(categorySlug, limit, sort, null, offset)
);

// البحث بنص حرّ: مفاتيحه غير محدودة نظرياً، لذلك تُرك بلا تخزين مؤقّت أول
// مرة. اختبار الضغط أظهر أن هذا هو **المسار الوحيد** الذي يسقط: عند 100
// طلب متزامن، كل الصفحات المُخزَّنة (الرئيسية والتصنيفات الثلاثة) ردّت 200
// في 1.0–1.9 ثانية، بينما 12 من 20 طلب بحث فشلت عند ~11 ثانية — أي أن
// عشرين استعلام بحث متزامن غير مُخزَّن وحدها تكفي لإشباع نسخة Micro.
//
// الحل ليس إلغاء التخزين ولا قبوله بلا حدود، بل **تحديد المفاتيح**: نُطبِّع
// عبارة البحث (قصّ، حروف صغيرة، توحيد المسافات) فتتقاسم الصياغات المختلفة
// لنفس البحث مفتاحاً واحداً، ونرفض تخزين العبارات الطويلة جداً (نادرة
// وغالباً آلية) فلا تتضخّم الذاكرة بمفاتيح تُقرأ مرة واحدة. مع مهلة 60
// ثانية، أي عبارة شائعة تُخدَّم من الذاكرة وأي عبارة نادرة تنتهي بسرعة.
const MAX_CACHEABLE_QUERY_LENGTH = 60;

export function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function isCacheableQuery(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= MAX_CACHEABLE_QUERY_LENGTH;
}

const queryProductsSearchCached = cachedCatalogQuery(
  ["catalog-products-search"],
  async (
    categorySlug: string | null,
    limit: number,
    sort: ProductSort,
    normalizedQuery: string,
    offset: number
  ) => runProductsQuery(categorySlug, limit, sort, `%${normalizedQuery}%`, offset)
);

const queryProductsBySkus = cachedCatalogQuery(
  ["catalog-products-by-skus"],
  async (skus: string[]) => {
    // `array_position` يُرجع الترتيب المطلوب حرفياً بدل ترتيب الجدول: هذه
    // القائمة مرتَّبة حسب الطلب المقاس، وترتيبها **هو** المعلومة.
    return sql<CatalogProduct[]>`
      select * from public.catalog_products
      where sku = any(${skus})
      order by array_position(${skus}::text[], sku)
    `;
  }
);

/**
 * منتجات بأكوادها، بنفس ترتيب القائمة الممرَّرة.
 *
 * وُجدت لقسم «الأكثر طلباً» في الصفحة الرئيسية: الترتيب الافتراضي للكتالوج
 * (sort_order ثم created_at) لا علاقة له بما يطلبه الزبناء فعلاً، وأول 16
 * منتجاً كانت تُعرض بلا أي صلة بالطلب المقاس. القائمة نفسها في
 * `lib/catalog/topDemand.ts` مع الأرقام التي بُنيت عليها.
 *
 * المنتجات غير المنشورة أو المحذوفة تسقط بصمت (العرض من `catalog_products`)،
 * فلا يكسر القسمَ كودٌ قديم في القائمة.
 */
export async function getProductsBySkus(skus: string[]): Promise<CatalogProduct[]> {
  if (skus.length === 0) return [];
  if (!hasDatabase) {
    const preview = getPreviewProducts({ limit: 200 });
    const bySku = new Map(preview.map((product) => [product.sku, product]));
    return skus.map((sku) => bySku.get(sku)).filter((p): p is CatalogProduct => Boolean(p));
  }

  try {
    return await queryProductsBySkus(skus);
  } catch (error) {
    failQuery("getProductsBySkus", error);
  }
}

/**
 * الحد الأقصى لعدد منتجات «الأكثر طلباً» المعروضة فالصفحة الرئيسية.
 *
 * القسم فوق الطيّة مباشرة، وكل بطاقة صورة تُحمَّل على هاتف بشبكة ضعيفة.
 * 24 تملأ ست صفوف على الهاتف — أكثر من ذلك يُعيد المشكلة التي وُجد القسم
 * لحلّها (تمرير طويل قبل الوصول لأي شيء آخر). الإدارة تختار ما تشاء،
 * والاستعلام يقطع عند هذا الحد.
 */
export const HOME_FEATURED_LIMIT = 24;

const queryFeaturedProducts = cachedCatalogQuery(
  ["catalog-home-featured"],
  async () => sql<CatalogProduct[]>`
    select p.* from public.home_featured_products f
    join public.catalog_products p on p.id = f.product_id
    order by f.position asc, f.product_id asc
    limit ${HOME_FEATURED_LIMIT}
  `
);

// **لا failQuery هنا عمداً — وهذا ليس تساهلاً.** failQuery ترمي
// ServiceUnavailableError، وsafeQuery تُعيد رميها قصداً حتى لا يُخدَّم متجر
// فارغ برمز 200. ذاك المنطق يخصّ التصنيفات والمنتجات: صفحة رئيسية بلا
// منتجات متجرٌ معطّل يجب أن يُعلن عطله. أما ما دون فليس كذلك، وله بديل
// معرَّف سلفاً — فإسقاط الصفحة كلها لأجله عطلٌ أكبر مما يعالج.
//
// وهذا وقع فعلاً، لا افتراضاً: أول بناء معاينة لهذا التغيير ردّ 500 على
// الصفحة الرئيسية، لأن home_featured_products لم تكن قد طُبِّقت على قاعدة
// المعاينة بعد. أي أن القسم الاختياري أسقط المتجر كله لدقائق بين الدمج
// وتطبيق الهجرة. الآن: يُسجَّل الخطأ ويُرجَع لا شيء، فتتراجع الصفحة إلى
// القائمة المقاسة — وهو نفس المسار المصمَّم أصلاً لحالة «لم يختر المدير».
/**
 * منتجات «الأكثر طلباً» التي اختارها صاحب المتجر يدوياً، بترتيبه هو.
 *
 * قائمة فارغة معناها «لم يختر شيئاً بعد» — والصفحة الرئيسية تتراجع عندها
 * إلى القائمة المقاسة فـlib/catalog/topDemand.ts. الاختيار اليدوي يفوز
 * دائماً حين يوجد، بلا خلط بين المصدرين.
 *
 * الربط بـcatalog_products (لا products) مقصود: منتج أُخفي أو نفد أو
 * أُرشِف يسقط من القسم تلقائياً بلا أن يحذفه المدير يدوياً، ولا يتسرّب من
 * هنا أي عمود سرّي (ثمن الشراء).
 */
export async function getFeaturedProducts(): Promise<CatalogProduct[]> {
  if (!hasDatabase) return [];

  try {
    return await queryFeaturedProducts();
  } catch (error) {
    console.error(
      "catalog.ts (getFeaturedProducts): تعذّر جلب اختيار الإدارة — نتراجع للقائمة المقاسة",
      error
    );
    return [];
  }
}

export async function getProducts(
  options: {
    categorySlug?: string;
    limit?: number;
    query?: string;
    sort?: ProductSort;
    // إزاحة لتصفّح المنتجات على دفعات ("عرض المزيد" فالصفحة الرئيسية) بدل
    // تحميل الكتالوج كله دفعة واحدة. القيمة الافتراضية 0، فكل مستدعٍ قديم
    // يبقى بنفس سلوكه بالضبط.
    offset?: number;
  } = {}
): Promise<CatalogProduct[]> {
  const { categorySlug, limit = 60, query, sort = "newest", offset = 0 } = options;

  if (!hasDatabase) return getPreviewProducts({ categorySlug, limit, query, sort });

  try {
    const pattern = query?.trim() ? `%${query.trim()}%` : null;
    // نُخزِّن مؤقتاً فقط التصفّح العادي (تصنيف + ترتيب + حد) — وهو ما تراه
    // الغالبية الساحقة من الزيارات ومفاتيحه محدودة العدد (13 تصنيفاً × 4
    // ترتيبات). البحث بنص حر لا يُخزَّن إطلاقاً: مفاتيحه غير محدودة أصلاً
    // (كل عبارة بحث مفتاح جديد)، فتخزينه يملأ الذاكرة ببيانات لن تُقرأ
    // ثانيةً بدل أن يوفّر أي استعلام حقيقي.
    const normalized = normalizeSearchQuery(query ?? "");
    const rows = !pattern
      ? await queryProductsCached(categorySlug ?? null, limit, sort, offset)
      : isCacheableQuery(normalized)
        ? await queryProductsSearchCached(categorySlug ?? null, limit, sort, normalized, offset)
        : await runProductsQuery(categorySlug ?? null, limit, sort, pattern, offset);
    if (rows.length === 0) {
      logEmptyResult(`getProducts(category=${categorySlug ?? "-"}, query=${query ?? "-"})`);
    }
    return rows;
  } catch (error) {
    failQuery("getProducts", error);
  }
}

const queryProductBySlug = cachedCatalogQuery(
  ["catalog-product-by-slug"],
  async (slug: string) => sql<CatalogProduct[]>`
    select * from public.catalog_products where slug = ${slug} limit 1
  `
);

// مُغلَّفة بـcache() لنفس سبب getCategoryBySlug أعلاه بالضبط: صفحة المنتج
// تستدعيها مرتين فعلياً (generateMetadata + مكوّن الصفحة).
export const getProductBySlug = cache(async (slug: string): Promise<CatalogProduct | null> => {
  if (!hasDatabase) return getPreviewProductBySlug(slug);

  try {
    const rows = await queryProductBySlug(slug);
    if (rows.length === 0) {
      logEmptyResult(`getProductBySlug(${slug})`);
    }
    return rows[0];
  } catch (error) {
    failQuery("getProductBySlug", error);
  }
});

const queryCategoryCoverImages = cachedCatalogQuery(
  ["catalog-category-covers"],
  async () => sql<{ category_slug: string; primary_image_path: string }[]>`
    select distinct on (p.category_slug) p.category_slug, p.primary_image_path
    from public.catalog_products p
    where p.primary_image_path is not null
    order by p.category_slug, p.sort_order asc, p.created_at desc
  `
);

/**
 * صورة غلاف لكل تصنيف، مأخوذة من **أول منتج فيه بترتيب المدير اليدوي**.
 *
 * لماذا وُجدت: بطاقات التصنيفات فالصفحة الرئيسية تستعمل صوراً ثابتة
 * مُصمَّمة فـpublic/categories، وصورتان منها كانتا ملفاً واحداً بايتاً
 * ببايت (سخان الماء الغازي والكهربائي)، ونصّها المطبوع داخلها يقول «قطع
 * غيار سخان الماء الغازي والكهربائي» — أي أنها صُمِّمت لتصنيف مدموج أصلاً،
 * بينما التصنيفان منفصلان فعلاً فقاعدة البيانات ولكلٍّ منتجاته (23 و8).
 * فالزبون يرى بطاقتين بنفس الصورة ونفس العنوان المطبوع، ولا يعرف أيهما
 * أيّ. ولا توجد فالمشروع صورة مصمَّمة أخرى لأيٍّ منهما (تاريخ git يُظهر
 * الملفين متطابقين منذ أول commit أضافهما).
 *
 * فبدل اختراع صورة جديدة، يأخذ التصنيف صورة قطعة حقيقية من قطعه هو —
 * موجودة أصلاً فقاعدة البيانات — ويُكتب اسمه نصاً تحتها. والاختيار ليس
 * عشوائياً: أول منتج بترتيب المدير اليدوي، فتغيير غلاف التصنيف يصير
 * بتحريك منتج إلى المرتبة 1 من /admin/products، بلا كود ولا رفع صور.
 */
export async function getCategoryCoverImages(): Promise<Record<string, string>> {
  if (!hasDatabase) {
    const covers: Record<string, string> = {};
    for (const product of getPreviewProducts({ limit: 500 })) {
      if (!product.primary_image_path) continue;
      covers[product.category_slug] ??= product.primary_image_path;
    }
    return covers;
  }

  try {
    const rows = await queryCategoryCoverImages();
    if (rows.length === 0) logEmptyResult("getCategoryCoverImages");
    return Object.fromEntries(rows.map((r) => [r.category_slug, r.primary_image_path]));
  } catch (error) {
    // بلا غلاف تعرض البطاقة الأيقونة والاسم (المسار الاحتياطي القائم منذ
    // البداية للتصنيفات بلا صورة) — صورةٌ ناقصة، لا متجر ساقط.
    console.error(
      "catalog.ts (getCategoryCoverImages): تعذّر جلب أغلفة التصنيفات — البطاقات تعرض الأيقونة",
      error
    );
    return {};
  }
}

const queryProductCountsByCategory = cachedCatalogQuery(
  ["catalog-product-counts"],
  async () => sql<{ category_id: number; count: number }[]>`
    select category_id, count(*)::int as count
    from public.catalog_products
    group by category_id
  `
);

export async function getProductCountsByCategory(): Promise<Record<number, number>> {
  if (!hasDatabase) return getPreviewProductCountsByCategory();

  try {
    const rows = await queryProductCountsByCategory();
    if (rows.length === 0) logEmptyResult("getProductCountsByCategory");
    return Object.fromEntries(rows.map((r) => [r.category_id, r.count]));
  } catch (error) {
    failQuery("getProductCountsByCategory", error);
  }
}

async function runSearchQuery(
  normalizedQuery: string,
  limit: number
): Promise<CatalogProduct[]> {
  const pattern = `%${normalizedQuery}%`;
  return sql<CatalogProduct[]>`
    select * from public.catalog_products
    where name_ar ilike ${pattern}
      or name_fr ilike ${pattern}
      or sku ilike ${pattern}
      or description_ar ilike ${pattern}
      or technical_specs ilike ${pattern}
    order by created_at desc
    limit ${limit}
  `;
}

const querySearchCached = cachedCatalogQuery(
  ["catalog-search"],
  async (normalizedQuery: string, limit: number) =>
    runSearchQuery(normalizedQuery, limit)
);

export async function searchProducts(
  query: string,
  limit = 60
): Promise<CatalogProduct[]> {
  const needle = query.trim();
  if (!needle) return [];

  if (!hasDatabase) return searchPreviewProducts(needle, limit);

  try {
    const normalized = normalizeSearchQuery(needle);
    const rows = isCacheableQuery(normalized)
      ? await querySearchCached(normalized, limit)
      : await runSearchQuery(normalized, limit);
    if (rows.length === 0) {
      logEmptyResult(`searchProducts(${needle})`);
    }
    return rows;
  } catch (error) {
    failQuery("searchProducts", error);
  }
}

const queryProductIdsWithVariants = cachedCatalogQuery(
  ["catalog-product-ids-with-variants"],
  async () => sql<{ product_id: number }[]>`
    select distinct product_id from public.catalog_product_variants
  `
);

export async function getProductIdsWithVariants(): Promise<Set<number>> {
  if (!hasDatabase) return getPreviewProductIdsWithVariants();

  try {
    const rows = await queryProductIdsWithVariants();
    if (rows.length === 0) {
      logEmptyResult("getProductIdsWithVariants");
    }
    return new Set(rows.map((r) => r.product_id));
  } catch (error) {
    failQuery("getProductIdsWithVariants", error);
  }
}

const queryProductVariants = cachedCatalogQuery(
  ["catalog-product-variants"],
  async (productId: number) => sql<CatalogProductVariant[]>`
    select * from public.catalog_product_variants
    where product_id = ${productId}
    order by sort_order asc
  `
);

export async function getProductVariants(
  productId: number
): Promise<CatalogProductVariant[]> {
  if (!hasDatabase) return getPreviewProductVariants(productId);

  try {
    const rows = await queryProductVariants(productId);
    if (rows.length === 0) {
      logEmptyResult(`getProductVariants(${productId})`);
    }
    return rows;
  } catch (error) {
    failQuery("getProductVariants", error);
  }
}

const queryProductImages = cachedCatalogQuery(
  ["catalog-product-images"],
  async (productId: number) => sql<CatalogProductImage[]>`
    select * from public.catalog_product_images
    where product_id = ${productId}
    order by is_primary desc, sort_order asc
  `
);

export async function getProductImages(
  productId: number
): Promise<CatalogProductImage[]> {
  if (!hasDatabase) return getPreviewProductImages(productId);

  try {
    const rows = await queryProductImages(productId);
    if (rows.length === 0) {
      logEmptyResult(`getProductImages(${productId})`);
    }
    return rows;
  } catch (error) {
    failQuery("getProductImages", error);
  }
}
