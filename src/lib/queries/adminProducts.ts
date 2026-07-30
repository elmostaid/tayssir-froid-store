import { sql } from "@/lib/db";

// استعلامات لوحة الإدارة فقط — تشمل purchase_price وكل الحالات (مسودة/
// منشور/غير متوفر/مؤرشف). لا تُستعمل هذه الدوال خارج مسارات /admin أبداً.

export type AdminProduct = {
  id: number;
  sku: string;
  slug: string;
  category_id: number;
  category_name_ar: string;
  name_ar: string;
  name_fr: string | null;
  description_ar: string | null;
  technical_specs: string | null;
  unit_label: string;
  min_order_qty: number;
  qty_increment: number;
  purchase_price: string | null;
  sale_price: string;
  stock_quantity: number;
  status: "draft" | "published" | "archived" | "out_of_stock";
};

export async function getAllProductsAdmin(): Promise<AdminProduct[]> {
  return sql<AdminProduct[]>`
    select
      p.id, p.sku, p.slug, p.category_id, c.name_ar as category_name_ar,
      p.name_ar, p.name_fr, p.description_ar, p.technical_specs, p.unit_label,
      p.min_order_qty, p.qty_increment, p.purchase_price, p.sale_price,
      p.stock_quantity, p.status
    from public.products p
    join public.categories c on c.id = p.category_id
    order by p.created_at desc
  `;
}

export async function getProductByIdAdmin(id: number): Promise<AdminProduct | null> {
  const rows = await sql<AdminProduct[]>`
    select
      p.id, p.sku, p.slug, p.category_id, c.name_ar as category_name_ar,
      p.name_ar, p.name_fr, p.description_ar, p.technical_specs, p.unit_label,
      p.min_order_qty, p.qty_increment, p.purchase_price, p.sale_price,
      p.stock_quantity, p.status
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = ${id}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function isSkuTakenByOtherProduct(sku: string, excludeId?: number): Promise<boolean> {
  const rows =
    excludeId !== undefined
      ? await sql`select id from public.products where sku = ${sku} and id != ${excludeId} limit 1`
      : await sql`select id from public.products where sku = ${sku} limit 1`;
  return rows.length > 0;
}

export async function isProductSlugTaken(slug: string, excludeId?: number): Promise<boolean> {
  const rows =
    excludeId !== undefined
      ? await sql`select id from public.products where slug = ${slug} and id != ${excludeId} limit 1`
      : await sql`select id from public.products where slug = ${slug} limit 1`;
  return rows.length > 0;
}

export type AdminProductVariant = {
  id: number;
  product_id: number;
  variant_name: string;
  sale_price_override: string | null;
  stock_quantity: number;
  min_order_qty_override: number | null;
  qty_increment_override: number | null;
  is_active: boolean;
  sort_order: number;
};

export async function getProductVariantsAdmin(productId: number): Promise<AdminProductVariant[]> {
  return sql<AdminProductVariant[]>`
    select id, product_id, variant_name, sale_price_override,
      stock_quantity, min_order_qty_override, qty_increment_override, is_active, sort_order
    from public.product_variants
    where product_id = ${productId}
    order by sort_order asc
  `;
}

export type AdminProductImage = {
  id: number;
  product_id: number;
  storage_path: string;
  alt_text_ar: string | null;
  sort_order: number;
  is_primary: boolean;
};

export async function getProductImagesAdmin(productId: number): Promise<AdminProductImage[]> {
  return sql<AdminProductImage[]>`
    select id, product_id, storage_path, alt_text_ar, sort_order, is_primary
    from public.product_images
    where product_id = ${productId}
    order by is_primary desc, sort_order asc
  `;
}
