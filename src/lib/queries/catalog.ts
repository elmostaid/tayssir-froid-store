import { sql } from "@/lib/db";
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

const hasDatabase = Boolean(process.env.DATABASE_URL);

export async function getCategories(): Promise<Category[]> {
  if (!hasDatabase) return getPreviewCategories();

  // نُخفي عن الزبون أي تصنيف بلا أي منتج ظاهر حالياً (المنتجات المحذوفة أو
  // غير المنشورة أصلاً لا تصل حتى إلى catalog_products)، بدون حذف التصنيف
  // نفسه من قاعدة البيانات — يبقى التصنيف موجوداً في لوحة الإدارة ويظهر
  // للزبون تلقائياً بمجرد نشر أول منتج فيه.
  return sql<Category[]>`
    select c.id, c.slug, c.name_ar, c.name_fr, c.description_ar, c.parent_id, c.sort_order
    from public.catalog_categories c
    where exists (
      select 1 from public.catalog_products p where p.category_id = c.id
    )
    order by c.sort_order asc, c.name_ar asc
  `;
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  if (!hasDatabase) return getPreviewCategoryBySlug(slug);

  const rows = await sql<Category[]>`
    select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order
    from public.catalog_categories
    where slug = ${slug}
    limit 1
  `;
  return rows[0] ?? null;
}

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

  const pattern = query?.trim() ? `%${query.trim()}%` : null;
  const orderBy =
    sort === "price_asc"
      ? sql`order by sale_price asc`
      : sort === "price_desc"
        ? sql`order by sale_price desc`
        : sort === "name"
          ? sql`order by name_ar asc`
          : sql`order by created_at desc`;

  return sql<CatalogProduct[]>`
    select * from public.catalog_products
    where (${categorySlug ?? null}::text is null or category_slug = ${categorySlug ?? null})
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

export async function getProductBySlug(slug: string): Promise<CatalogProduct | null> {
  if (!hasDatabase) return getPreviewProductBySlug(slug);

  const rows = await sql<CatalogProduct[]>`
    select * from public.catalog_products where slug = ${slug} limit 1
  `;
  return rows[0] ?? null;
}

export async function getProductCountsByCategory(): Promise<Record<number, number>> {
  if (!hasDatabase) return getPreviewProductCountsByCategory();

  const rows = await sql<{ category_id: number; count: number }[]>`
    select category_id, count(*)::int as count
    from public.catalog_products
    group by category_id
  `;
  return Object.fromEntries(rows.map((r) => [r.category_id, r.count]));
}

export async function searchProducts(
  query: string,
  limit = 60
): Promise<CatalogProduct[]> {
  const needle = query.trim();
  if (!needle) return [];

  if (!hasDatabase) return searchPreviewProducts(needle, limit);

  const pattern = `%${needle}%`;
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

export async function getProductIdsWithVariants(): Promise<Set<number>> {
  if (!hasDatabase) return getPreviewProductIdsWithVariants();

  const rows = await sql<{ product_id: number }[]>`
    select distinct product_id from public.catalog_product_variants
  `;
  return new Set(rows.map((r) => r.product_id));
}

export async function getProductVariants(
  productId: number
): Promise<CatalogProductVariant[]> {
  if (!hasDatabase) return getPreviewProductVariants(productId);

  return sql<CatalogProductVariant[]>`
    select * from public.catalog_product_variants
    where product_id = ${productId}
    order by sort_order asc
  `;
}

export async function getProductImages(
  productId: number
): Promise<CatalogProductImage[]> {
  if (!hasDatabase) return getPreviewProductImages(productId);

  return sql<CatalogProductImage[]>`
    select * from public.catalog_product_images
    where product_id = ${productId}
    order by is_primary desc, sort_order asc
  `;
}
