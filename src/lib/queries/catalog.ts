import { cache } from "react";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { safeQuery } from "@/lib/safeQuery";
import { CATALOG_TAG, CATALOG_REVALIDATE_SECONDS } from "@/lib/queries/catalogCache";
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
  return unstable_cache(run, keyParts, {
    tags: [CATALOG_TAG],
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
}

function logDbFallback(context: string, error: unknown) {
  console.error(
    `catalog.ts (${context}): فشل الاستعلام على قاعدة البيانات الحقيقية، استعمال البيانات المحلية الاحتياطية`,
    error
  );
}

function logEmptyFallback(context: string) {
  console.error(
    `catalog.ts (${context}): الاستعلام على قاعدة البيانات الحقيقية نجح لكنه أعاد صفر نتائج (على الأرجح migrations لم تُطبَّق بعد أو القاعدة لا تحتوي منتجات منشورة) — استعمال البيانات المحلية الاحتياطية مؤقتاً`
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
      logEmptyFallback("getCategories");
      return getPreviewCategories();
    }
    return rows;
  } catch (error) {
    logDbFallback("getCategories", error);
    return getPreviewCategories();
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
      logEmptyFallback(`getCategoryBySlug(${slug})`);
      return getPreviewCategoryBySlug(slug);
    }
    return rows[0];
  } catch (error) {
    logDbFallback("getCategoryBySlug", error);
    return getPreviewCategoryBySlug(slug);
  }
});

async function runProductsQuery(
  categorySlug: string | null,
  limit: number,
  sort: ProductSort,
  pattern: string | null
): Promise<CatalogProduct[]> {
  // الترتيب الافتراضي ("الأحدث"): ترتيب المدير اليدوي داخل التصنيف
  // (sort_order تصاعدياً) أولاً — أزرار "↑ طلّع"/"↓ هبّط" فـ/admin/products
  // تُحدِّثه مباشرة — ثم created_at تنازلياً كـfallback ثابت عند تساوي
  // sort_order (كل المنتجات القديمة تبدأ بقيم sort_order مختلفة أصلاً؛
  // التساوي يحدث فقط لمنتجات جديدة لم تُرتَّب يدوياً بعد).
  const orderBy =
    sort === "price_asc"
      ? sql`order by sale_price asc`
      : sort === "price_desc"
        ? sql`order by sale_price desc`
        : sort === "name"
          ? sql`order by name_ar asc`
          : sql`order by sort_order asc, created_at desc`;

  return sql<CatalogProduct[]>`
    select * from public.catalog_products
    where (${categorySlug}::text is null or category_slug = ${categorySlug})
      and (
        ${pattern}::text is null
        or name_ar ilike ${pattern}
        or name_fr ilike ${pattern}
        or sku ilike ${pattern}
        or description_ar ilike ${pattern}
      )
    ${orderBy}
    limit ${limit}
  `;
}

const queryProductsCached = cachedCatalogQuery(
  ["catalog-products"],
  async (categorySlug: string | null, limit: number, sort: ProductSort) =>
    runProductsQuery(categorySlug, limit, sort, null)
);

export async function getProducts(
  options: {
    categorySlug?: string;
    limit?: number;
    query?: string;
    sort?: ProductSort;
  } = {}
): Promise<CatalogProduct[]> {
  const { categorySlug, limit = 60, query, sort = "newest" } = options;

  if (!hasDatabase) return getPreviewProducts({ categorySlug, limit, query, sort });

  try {
    const pattern = query?.trim() ? `%${query.trim()}%` : null;
    // نُخزِّن مؤقتاً فقط التصفّح العادي (تصنيف + ترتيب + حد) — وهو ما تراه
    // الغالبية الساحقة من الزيارات ومفاتيحه محدودة العدد (13 تصنيفاً × 4
    // ترتيبات). البحث بنص حر لا يُخزَّن إطلاقاً: مفاتيحه غير محدودة أصلاً
    // (كل عبارة بحث مفتاح جديد)، فتخزينه يملأ الذاكرة ببيانات لن تُقرأ
    // ثانيةً بدل أن يوفّر أي استعلام حقيقي.
    const rows = pattern
      ? await runProductsQuery(categorySlug ?? null, limit, sort, pattern)
      : await queryProductsCached(categorySlug ?? null, limit, sort);
    if (rows.length === 0) {
      logEmptyFallback(`getProducts(category=${categorySlug ?? "-"}, query=${query ?? "-"})`);
      return getPreviewProducts({ categorySlug, limit, query, sort });
    }
    return rows;
  } catch (error) {
    logDbFallback("getProducts", error);
    return getPreviewProducts({ categorySlug, limit, query, sort });
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
      logEmptyFallback(`getProductBySlug(${slug})`);
      return getPreviewProductBySlug(slug);
    }
    return rows[0];
  } catch (error) {
    logDbFallback("getProductBySlug", error);
    return getPreviewProductBySlug(slug);
  }
});

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
    if (rows.length === 0) {
      logEmptyFallback("getProductCountsByCategory");
      return getPreviewProductCountsByCategory();
    }
    return Object.fromEntries(rows.map((r) => [r.category_id, r.count]));
  } catch (error) {
    logDbFallback("getProductCountsByCategory", error);
    return getPreviewProductCountsByCategory();
  }
}

export async function searchProducts(
  query: string,
  limit = 60
): Promise<CatalogProduct[]> {
  const needle = query.trim();
  if (!needle) return [];

  if (!hasDatabase) return searchPreviewProducts(needle, limit);

  try {
    const pattern = `%${needle}%`;
    const rows = await sql<CatalogProduct[]>`
      select * from public.catalog_products
      where name_ar ilike ${pattern}
        or name_fr ilike ${pattern}
        or sku ilike ${pattern}
        or description_ar ilike ${pattern}
        or technical_specs ilike ${pattern}
      order by created_at desc
      limit ${limit}
    `;
    if (rows.length === 0) {
      logEmptyFallback(`searchProducts(${needle})`);
      return searchPreviewProducts(needle, limit);
    }
    return rows;
  } catch (error) {
    logDbFallback("searchProducts", error);
    return searchPreviewProducts(needle, limit);
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
      logEmptyFallback("getProductIdsWithVariants");
      return getPreviewProductIdsWithVariants();
    }
    return new Set(rows.map((r) => r.product_id));
  } catch (error) {
    logDbFallback("getProductIdsWithVariants", error);
    return getPreviewProductIdsWithVariants();
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
      const previewFallback = getPreviewProductVariants(productId);
      if (previewFallback.length > 0) {
        logEmptyFallback(`getProductVariants(${productId})`);
        return previewFallback;
      }
      // منتج حقيقي بلا أي variant فعلاً (حالة صحيحة وشائعة) — لا داعي للتراجع.
      return rows;
    }
    return rows;
  } catch (error) {
    logDbFallback("getProductVariants", error);
    return getPreviewProductVariants(productId);
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
      const previewFallback = getPreviewProductImages(productId);
      if (previewFallback.length > 0) {
        logEmptyFallback(`getProductImages(${productId})`);
        return previewFallback;
      }
      // منتج حقيقي بلا صور فعلاً — لا داعي للتراجع.
      return rows;
    }
    return rows;
  } catch (error) {
    logDbFallback("getProductImages", error);
    return getPreviewProductImages(productId);
  }
}
