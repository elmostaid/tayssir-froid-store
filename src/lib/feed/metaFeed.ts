import { sql } from "@/lib/db";
import { resolveProductImageUrl } from "@/lib/storage/resolveProductImageUrl";
import type { CatalogProduct } from "@/lib/types";

// خلاصة Meta/WhatsApp Catalog البسيطة والموثوقة: مصدرها الوحيد هو
// public.catalog_products (نفس الـview التي تعتمد عليها صفحات الموقع
// للزبون في catalog.ts) — لا تُقرأ أي بيانات أخرى ولا تُكتَب/تُعدَّل أي
// بيانات منتج هنا إطلاقاً. الـview نفسها تستبعد أصلاً أي منتج غير
// "published"/"out_of_stock" وأي تصنيف غير فعّال، وتستبعد عمود ثمن الشراء
// (purchase_price) بنيوياً (العمود غير موجود أصلاً في تعريف الـview) — لا
// حاجة لأي فلترة إضافية هنا لضمان ذلك.
const STORE_BRAND = "Tayssir Froid";
const CURRENCY = "MAD";

// رابط الإنتاج الحقيقي والوحيد لهذه الخلاصة تحديداً — مُثبَّت مباشرة (وليس
// عبر getSiteUrl()/متغيرات Vercel التي قد ترجع رابط Preview أو تبقى غير
// مضبوطة) لأن Meta/WhatsApp يرفضان أي رابط لا يبدأ فعلياً بدومين الإنتاج
// النهائي، ولا مجال إطلاقاً لتسرّب رابط localhost أو *.vercel.app هنا.
const PRODUCTION_SITE_URL = "https://www.tayssirfroid.com";

export type MetaFeedRow = {
  id: string;
  title: string;
  description: string;
  availability: "in stock" | "out of stock";
  condition: "new";
  price: string;
  link: string;
  image_link: string;
  brand: string;
  product_type: string;
};

export type MetaFeedResult = {
  rows: MetaFeedRow[];
  totalProducts: number;
  includedCount: number;
  excludedNoImageCount: number;
  excludedNoImageSkus: string[];
  duplicateSkus: string[];
};

function priceString(amount: string | number): string {
  return `${Number(amount).toFixed(2)} ${CURRENCY}`;
}

function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${PRODUCTION_SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function buildMetaFeed(): Promise<MetaFeedResult> {
  const products = await sql<CatalogProduct[]>`
    select
      id, sku, slug, category_id, category_slug, category_name_ar,
      name_ar, name_fr, description_ar, technical_specs, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity,
      meta_title, meta_description, primary_image_path, status, sort_order
    from public.catalog_products
    order by sku asc
  `;

  const rows: MetaFeedRow[] = [];
  const seenSkus = new Set<string>();
  const duplicateSkus: string[] = [];
  const excludedNoImageSkus: string[] = [];

  for (const product of products) {
    if (seenSkus.has(product.sku)) {
      duplicateSkus.push(product.sku);
      continue;
    }
    seenSkus.add(product.sku);

    // "لا يوجد منتوج بدون image_link" — منتج بلا أي صورة أصلاً (primary_image_path
    // فارغ) يُستبعَد كلياً من الخلاصة بدل إرسال image_link فارغ (Meta يرفض
    // الصف بأكمله فهذه الحالة على أي حال).
    if (!product.primary_image_path) {
      excludedNoImageSkus.push(product.sku);
      continue;
    }

    const resolvedImagePath = await resolveProductImageUrl(product.primary_image_path);

    rows.push({
      id: product.sku,
      title: product.name_ar,
      description: product.description_ar ?? product.meta_description ?? product.name_ar,
      availability: product.stock_quantity > 0 ? "in stock" : "out of stock",
      condition: "new",
      price: priceString(product.sale_price),
      link: absoluteUrl(`/product/${product.slug}`),
      image_link: absoluteUrl(resolvedImagePath),
      brand: STORE_BRAND,
      product_type: product.category_name_ar,
    });
  }

  return {
    rows,
    totalProducts: products.length,
    includedCount: rows.length,
    excludedNoImageCount: excludedNoImageSkus.length,
    excludedNoImageSkus,
    duplicateSkus,
  };
}

const CSV_COLUMNS: (keyof MetaFeedRow)[] = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "brand",
  "product_type",
];

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// بدون UTF-8 BOM عمداً — نفس السبب الموثَّق فـmetaCatalog.ts: BOM يُلحَق
// حرفياً بأول عمود فيصبح اسمه "﻿id" بدل "id"، فيفشل تعرّف محلِّل استيراد
// Meta/WhatsApp الآلي على العمود بالكامل. الترميز يبقى UTF-8 حقيقياً
// وسليماً 100% (البايتات صحيحة، والترويسة Content-Type تصرّح بـcharset=utf-8
// صراحة) — كافٍ لبقاء الأسماء العربية صحيحة بلا أي حاجة لـBOM.
export function metaFeedRowsToCsv(rows: MetaFeedRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
