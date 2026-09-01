import { sql } from "@/lib/db";

// استعلامات صفحة /admin/featured («الأكثر طلباً» فالصفحة الرئيسية).
//
// القسم يعرض منتجات مختارة يدوياً بترتيب مستقل تماماً عن products.sort_order
// (ذاك ترتيب المنتج داخل تصنيفه، ويحكم صفحة التصنيف و«جميع المنتجات»).
// المصدر هنا جدول home_featured_products وحده.

export type FeaturedProduct = {
  product_id: number;
  position: number;
  sku: string;
  name_ar: string;
  status: "draft" | "published" | "archived" | "out_of_stock";
  category_name_ar: string;
  sale_price: string;
  stock_quantity: number;
  primary_image_path: string | null;
};

/**
 * القائمة المختارة حالياً بترتيبها.
 *
 * تُقرأ من public.products وليس catalog_products عمداً: المدير يجب أن يرى
 * منتجاً اختاره ثم صار مسودة أو مؤرشفاً — وإلا اختفى من لوحته بلا تفسير
 * بينما هو ما زال محجوزاً فالجدول. الواجهة تُنبِّهه أنه لا يظهر للزبون.
 */
export async function listFeaturedAdmin(): Promise<FeaturedProduct[]> {
  return sql<FeaturedProduct[]>`
    select
      f.product_id, f.position, p.sku, p.name_ar, p.status, p.sale_price,
      p.stock_quantity, c.name_ar as category_name_ar,
      (
        select pi.storage_path from public.product_images pi
        where pi.product_id = p.id
        order by pi.is_primary desc, pi.sort_order asc
        limit 1
      ) as primary_image_path
    from public.home_featured_products f
    join public.products p on p.id = f.product_id
    join public.categories c on c.id = p.category_id
    order by f.position asc, f.product_id asc
  `;
}

export type FeaturableProduct = {
  id: number;
  sku: string;
  name_ar: string;
  status: "draft" | "published" | "archived" | "out_of_stock";
  category_name_ar: string;
  sale_price: string;
  primary_image_path: string | null;
};

/**
 * منتجات مرشَّحة للإضافة: بحث بالاسم أو SKU، بلا ما هو مختار أصلاً.
 *
 * الكتالوج يتجاوز 300 منتج، فعرضها كلها فقائمة اختيار غير عملي على الهاتف —
 * البحث هو الواجهة. الحدّ 30 يكفي لاختيار واعٍ ويمنع صفحة ثقيلة.
 */
export async function searchFeaturableProducts(
  query: string,
  limit = 30
): Promise<FeaturableProduct[]> {
  const needle = query.trim();
  if (!needle) return [];
  const pattern = `%${needle}%`;

  return sql<FeaturableProduct[]>`
    select
      p.id, p.sku, p.name_ar, p.status, p.sale_price,
      c.name_ar as category_name_ar,
      (
        select pi.storage_path from public.product_images pi
        where pi.product_id = p.id
        order by pi.is_primary desc, pi.sort_order asc
        limit 1
      ) as primary_image_path
    from public.products p
    join public.categories c on c.id = p.category_id
    where (p.name_ar ilike ${pattern} or p.sku ilike ${pattern})
      and not exists (
        select 1 from public.home_featured_products f where f.product_id = p.id
      )
    order by p.name_ar asc
    limit ${limit}
  `;
}
