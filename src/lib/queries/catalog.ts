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
} from "@/lib/previewCatalog";

// كل الاستعلامات هنا تقرأ من views عامة (catalog_*) لا تحتوي أبداً على
// عمود ثمن الشراء السري، ولا تعرض إلا المنتجات المنشورة والتصنيفات الفعالة.
//
// بدون DATABASE_URL (مثلاً عند النشر على Vercel بدون قاعدة بيانات حقيقية)،
// تُستعمل نفس بيانات المنتجات والصور المحلية المستعملة في /preview بدل
// الاتصال بقاعدة البيانات.

const hasDatabase = Boolean(process.env.DATABASE_URL);

export async function getCategories(): Promise<Category[]> {
  if (!hasDatabase) return getPreviewCategories();

  return sql<Category[]>`
    select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order
    from public.catalog_categories
    order by sort_order asc, name_ar asc
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
  options: { categorySlug?: string; limit?: number } = {}
): Promise<CatalogProduct[]> {
  const { categorySlug, limit = 60 } = options;

  if (!hasDatabase) return getPreviewProducts({ categorySlug, limit });

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
  if (!hasDatabase) return getPreviewProductBySlug(slug);

  const rows = await sql<CatalogProduct[]>`
    select * from public.catalog_products where slug = ${slug} limit 1
  `;
  return rows[0] ?? null;
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
