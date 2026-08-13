import {
  getAllProductsForExport,
  getAllVariantsForExport,
  getAllProductImagesForExport,
} from "@/lib/queries/catalogExport";
import { resolveImageUrl } from "@/lib/images";
import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";
import { getSiteUrl } from "@/lib/siteUrl";
import type { CatalogProductVariant, CatalogProductImage } from "@/lib/types";

const STORE_BRAND = "Tayssir Froid";
const CURRENCY = "MAD";

export type MetaCatalogCleanRow = {
  id: string;
  item_group_id: string;
  title: string;
  description: string;
  availability: "in stock" | "out of stock";
  condition: "new";
  price: string;
  link: string;
  image_link: string;
  additional_image_link: string;
  brand: string;
  product_type: string;
};

export type CleanCatalogExportResult = {
  rows: MetaCatalogCleanRow[];
  totalProducts: number;
  totalVariants: number;
  includedProducts: number;
  excludedProducts: number;
  validImageCount: number;
  brokenImageCount: number;
  brokenImageSkus: string[];
  siteUrl: string | null;
};

function priceString(amount: string | number): string {
  return `${Number(amount).toFixed(2)} ${CURRENCY}`;
}

// عنوان الموقع المطلَق المستعمل لبناء image_link/link. الأولوية:
// 1) SITE_URL — يُضبط يدوياً بعد ربط دومين نهائي.
// 2) VERCEL_BRANCH_URL — رابط Vercel الثابت لكل فرع (نفس الرابط اللي يفتحه
//    الزبون من الهاتف لمعاينة هذا الفرع بالضبط)، يُضبط تلقائياً من Vercel
//    بلا أي إعداد يدوي — هذا ما يجعل الخلاصة تشتغل مباشرة على أي Preview.
// 3) VERCEL_URL — رابط النشر الحالي (يتغيّر مع كل deployment) كحل أخير.
// لا رابط نسبي أبداً هنا (Meta يرفض روابط الصور غير المطلَقة).
function resolveAbsoluteSiteUrl(): string | null {
  const explicit = getSiteUrl();
  if (explicit) return explicit;

  const branchUrl = process.env.VERCEL_BRANCH_URL?.trim();
  if (branchUrl) return `https://${branchUrl.replace(/\/$/, "")}`;

  const deploymentUrl = process.env.VERCEL_URL?.trim();
  if (deploymentUrl) return `https://${deploymentUrl.replace(/\/$/, "")}`;

  return null;
}

// path قد يكون مساراً محلياً نسبياً ("/product-images/...") أو رابطاً
// مطلقاً جاهزاً بالفعل (Supabase Storage public URL) — لا نُلحق siteUrl إذا
// كان مطلقاً أصلاً، وإلا ننتج رابطاً مكسوراً (siteUrl + رابط https كامل).
function absoluteUrl(siteUrl: string | null, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return siteUrl ? `${siteUrl}${path}` : path;
}

export async function buildCleanCatalogExport(): Promise<CleanCatalogExportResult> {
  const [products, variants, images] = await Promise.all([
    getAllProductsForExport(),
    getAllVariantsForExport(),
    getAllProductImagesForExport(),
  ]);

  const siteUrl = resolveAbsoluteSiteUrl();
  // نفس المصدر المركزي resolveProductImageUrls (محلي للصور القديمة، أو
  // Supabase Storage الحقيقي للصور المرفوعة حديثاً) — يُحل دفعة واحدة قبل
  // الحلقة بدل استدعاء متزامن قديم per-row كان يفترض مساراً محلياً دائماً.
  const imageUrlByPath = await resolveProductImageUrls(images.map((img) => img.storage_path));

  const variantsByProduct = new Map<number, CatalogProductVariant[]>();
  for (const variant of variants) {
    const list = variantsByProduct.get(variant.product_id) ?? [];
    list.push(variant);
    variantsByProduct.set(variant.product_id, list);
  }

  const imagesByProduct = new Map<number, CatalogProductImage[]>();
  for (const image of images) {
    const list = imagesByProduct.get(image.product_id) ?? [];
    list.push(image);
    imagesByProduct.set(image.product_id, list);
  }

  const rows: MetaCatalogCleanRow[] = [];
  let includedProducts = 0;
  let excludedProducts = 0;
  const brokenImageSkus: string[] = [];
  let validImageCount = 0;
  let brokenImageCount = 0;

  for (const product of products) {
    // category_is_active غائب فقط عن البيانات المحلية الاحتياطية
    // (previewCatalog، لا تصنيفات مخفية فيها أصلاً) — نعتبره ظاهراً حينها.
    const categoryVisible = product.category_is_active !== false;
    const isPublished =
      (product.status === "published" || product.status === "out_of_stock") && categoryVisible;
    if (!isPublished) {
      excludedProducts += 1;
      continue;
    }

    const productImages = (imagesByProduct.get(product.id) ?? []).slice().sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.sort_order - b.sort_order;
    });

    if (productImages.length === 0) {
      excludedProducts += 1;
      brokenImageSkus.push(product.sku);
      brokenImageCount += 1;
      continue;
    }

    const [primaryImage, ...otherImages] = productImages;
    const imageLink = absoluteUrl(
      siteUrl,
      imageUrlByPath[primaryImage.storage_path] ?? resolveImageUrl(primaryImage.storage_path)
    );
    const additionalImageLink = otherImages
      .map((img) =>
        absoluteUrl(siteUrl, imageUrlByPath[img.storage_path] ?? resolveImageUrl(img.storage_path))
      )
      .join(",");

    validImageCount += 1 + otherImages.length;

    includedProducts += 1;
    const productVariants = variantsByProduct.get(product.id) ?? [];
    const link = absoluteUrl(siteUrl, `/product/${product.slug}`);
    const description = product.description_ar ?? product.name_ar;
    const productType = product.category_name_ar;

    if (productVariants.length === 0) {
      rows.push({
        id: product.sku,
        item_group_id: "",
        title: product.name_ar,
        description,
        availability: product.stock_quantity > 0 ? "in stock" : "out of stock",
        condition: "new",
        price: priceString(product.sale_price),
        link,
        image_link: imageLink,
        additional_image_link: additionalImageLink,
        brand: STORE_BRAND,
        product_type: productType,
      });
    } else {
      for (const variant of productVariants) {
        rows.push({
          id: `${product.sku}-${variant.id}`,
          item_group_id: product.sku,
          title: `${product.name_ar} — ${variant.variant_name}`,
          description,
          availability: variant.stock_quantity > 0 ? "in stock" : "out of stock",
          condition: "new",
          price: priceString(variant.sale_price),
          link,
          image_link: imageLink,
          additional_image_link: additionalImageLink,
          brand: STORE_BRAND,
          product_type: productType,
        });
      }
    }
  }

  return {
    rows,
    totalProducts: products.length,
    totalVariants: variants.length,
    includedProducts,
    excludedProducts,
    validImageCount,
    brokenImageCount,
    brokenImageSkus,
    siteUrl,
  };
}

const CSV_COLUMNS: (keyof MetaCatalogCleanRow)[] = [
  "id",
  "item_group_id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "additional_image_link",
  "brand",
  "product_type",
];

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// بدون UTF-8 BOM عمداً — نفس السبب الموثَّق في metaCatalog.ts: BOM يكسر
// محلِّل استيراد Meta الآلي (يُلحَق حرفياً بأول عمود فيصبح "﻿id" بدل "id").
export function cleanRowsToCsv(rows: MetaCatalogCleanRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
