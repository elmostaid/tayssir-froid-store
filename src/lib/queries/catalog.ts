import { sql, isDatabaseConfigured } from "@/lib/db";
import { staticCatalog } from "@/lib/data/staticCatalogFallback";
import type {
  Category,
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductImage,
} from "@/lib/types";

// كل الاستعلامات هنا تقرأ من views عامة (catalog_*) لا تحتوي أبداً على
// عمود ثمن الشراء السري، ولا تعرض إلا المنتجات المنشورة والتصنيفات الفعالة.
//
// عندما DATABASE_URL غير معرَّف (مثلاً معاينة Vercel بدون قاعدة بيانات)
// تُخدَّم هذه الدوال من نسخة ثابتة محلية من نفس البيانات (staticCatalog.json)
// مُصدَّرة سلفاً من نفس الـviews الآمنة — دون أي تعديل على الشكل أو الواجهة.

export async function getCategories(): Promise<Category[]> {
  if (!isDatabaseConfigured) return staticCatalog.categories;

  return sql<Category[]>`
    select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order
    from public.catalog_categories
    order by sort_order asc, name_ar asc
  `;
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  if (!isDatabaseConfigured) {
    return staticCatalog.categories.find((c) => c.slug === slug) ?? null;
  }

  const rows = await sql<Category[]>`
    select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order
    from public.catalog_categories
    where slug = ${slug}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getProducts(
  options: { categorySlug?: string; limit?: number } = {}
): Promise<CatalogProduct[]> {
  const { categorySlug, limit = 60 } = options;

  if (!isDatabaseConfigured) {
    const all = categorySlug
      ? staticCatalog.products.filter((p) => p.category_slug === categorySlug)
      : staticCatalog.products;
    return all.slice(0, limit);
  }

  if (categorySlug) {
    return sql<CatalogProduct[]>`
      select * from public.catalog_products
      where category_slug = ${categorySlug}
      order by created_at desc
      limit ${limit}
    `;
  }

  return sql<CatalogProduct[]>`
    select * from public.catalog_products
    order by created_at desc
    limit ${limit}
  `;
}

export async function getProductBySlug(slug: string): Promise<CatalogProduct | null> {
  if (!isDatabaseConfigured) {
    return staticCatalog.products.find((p) => p.slug === slug) ?? null;
  }

  const rows = await sql<CatalogProduct[]>`
    select * from public.catalog_products where slug = ${slug} limit 1
  `;
  return rows[0] ?? null;
}

export async function getProductVariants(
  productId: number
): Promise<CatalogProductVariant[]> {
  if (!isDatabaseConfigured) {
    return staticCatalog.variantsByProductId[productId] ?? [];
  }

  return sql<CatalogProductVariant[]>`
    select * from public.catalog_product_variants
    where product_id = ${productId}
    order by sort_order asc
  `;
}

export async function getProductImages(
  productId: number
): Promise<CatalogProductImage[]> {
  if (!isDatabaseConfigured) {
    return staticCatalog.imagesByProductId[productId] ?? [];
  }

  return sql<CatalogProductImage[]>`
    select * from public.catalog_product_images
    where product_id = ${productId}
    order by is_primary desc, sort_order asc
  `;
}
