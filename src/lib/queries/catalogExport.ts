import { sql } from "@/lib/db";
import {
  getAllPreviewProductsForExport,
  getAllPreviewVariantsForExport,
  getAllPreviewProductImagesForExport,
} from "@/lib/previewCatalog";
import type { CatalogProduct, CatalogProductVariant, CatalogProductImage } from "@/lib/types";

const hasDatabase = Boolean(process.env.DATABASE_URL);

// النسخة المحلية (fallback) لا تحوي حالياً إلا "published"، لكن قاعدة
// البيانات الحقيقية تسمح أيضاً بـ"draft"/"archived" — هذا النوع الأوسع
// خاص بالتدقيق/التصدير فقط، وليس نوع CatalogProduct المقيَّد المستعمل في
// صفحات الزبون.
export type ExportProduct = Omit<CatalogProduct, "status"> & {
  status: "draft" | "published" | "archived" | "out_of_stock";
};

// لأغراض التدقيق والتصدير (Meta Commerce Catalog) فقط: كل المنتجات بكل
// الحالات (منشور/مسودة/مؤرشف/غير متوفر)، بدون عمود purchase_price إطلاقاً
// — هذا الاستعلام لا يُستعمل أبداً من أي صفحة يراها الزبون مباشرة.
//
// إن كان DATABASE_URL معرَّفاً لكن الاتصال أو التحقق فشل فعلياً وقت التنفيذ
// (كلمة سر خاطئة، قاعدة متوقفة...)، نستعمل نفس البيانات المحلية الاحتياطية
// (previewCatalog) بدل السماح لخطأ postgres بإسقاط الـRoute بأكمله بـ500 —
// تماماً كما يتصرف باقي الموقع (catalog.ts) عند غياب DATABASE_URL من الأصل.
export async function getAllProductsForExport(): Promise<ExportProduct[]> {
  if (!hasDatabase) return getAllPreviewProductsForExport() as ExportProduct[];

  try {
    return await sql<ExportProduct[]>`
      select
        p.id, p.sku, p.slug, p.category_id, c.slug as category_slug,
        c.name_ar as category_name_ar, p.name_ar, p.name_fr, p.description_ar,
        p.technical_specs, p.unit_label, p.min_order_qty, p.qty_increment,
        p.sale_price, p.stock_quantity, p.meta_title, p.meta_description,
        (
          select pi.storage_path from public.product_images pi
          where pi.product_id = p.id
          order by pi.is_primary desc, pi.sort_order asc
          limit 1
        ) as primary_image_path,
        p.status
      from public.products p
      join public.categories c on c.id = p.category_id
      order by p.id asc
    `;
  } catch (error) {
    console.error(
      "getAllProductsForExport: تعذّر الاتصال بقاعدة البيانات، استعمال البيانات المحلية الاحتياطية",
      error
    );
    return getAllPreviewProductsForExport() as ExportProduct[];
  }
}

export async function getAllVariantsForExport(): Promise<CatalogProductVariant[]> {
  if (!hasDatabase) return getAllPreviewVariantsForExport();

  try {
    return await sql<CatalogProductVariant[]>`
      select id, product_id, variant_name, sale_price, stock_quantity,
        min_order_qty, qty_increment, sort_order
      from public.product_variants
      order by product_id asc, sort_order asc
    `;
  } catch (error) {
    console.error(
      "getAllVariantsForExport: تعذّر الاتصال بقاعدة البيانات، استعمال البيانات المحلية الاحتياطية",
      error
    );
    return getAllPreviewVariantsForExport();
  }
}

// كل صور كل المنتجات (وليس فقط الصورة الرئيسية)، لأغراض التصدير/الخلاصة
// فقط (مثل additional_image_link في Meta Commerce Catalog) — وليس لأي صفحة
// يراها الزبون مباشرة.
export async function getAllProductImagesForExport(): Promise<CatalogProductImage[]> {
  if (!hasDatabase) return getAllPreviewProductImagesForExport();

  try {
    return await sql<CatalogProductImage[]>`
      select id, product_id, storage_path, alt_text_ar, sort_order, is_primary
      from public.product_images
      order by product_id asc, is_primary desc, sort_order asc
    `;
  } catch (error) {
    console.error(
      "getAllProductImagesForExport: تعذّر الاتصال بقاعدة البيانات، استعمال البيانات المحلية الاحتياطية",
      error
    );
    return getAllPreviewProductImagesForExport();
  }
}
