import { getAllProductsForExport, getAllVariantsForExport } from "@/lib/queries/catalogExport";
import { resolveImageUrl } from "@/lib/images";
import { getSiteUrl } from "@/lib/siteUrl";
import type { CatalogProductVariant } from "@/lib/types";

const STORE_BRAND = "Tayssir Froid";
const CURRENCY = "MAD";

// SKUs التي صورتها الرئيسية غير مناسبة لكتالوج Meta (لقطة شاشة إعلانية
// كاملة فيها ثمن/واجهة هاتف، أو شعار جزئي مشكوك فيه) — نفس قائمة
// image_manual_review.csv في جذر المشروع بالضبط. حدِّث هذه القائمة إذا
// تغيّر ذلك الملف (صور جديدة أو صور أُصلحت).
const UNSUITABLE_PRIMARY_IMAGE_SKUS = new Set([
  "TF-RF-004",
  "TF-RF-005",
  "TF-RF-006",
  "TF-RF-007",
  "TF-RF-008",
  "TF-RF-009",
  "TF-RF-010",
  "TF-RF-012",
  "TF-RF-013",
  "TF-RF-016",
  "TF-RF-021",
  "TF-WM-046",
]);

// أوصاف عامة مكرَّرة عبر عشرات المنتجات (من الدفعات القديمة، قبل كتابة
// وصف خاص بكل منتج) — تُقبَل في الخلاصة (ليست خطأ حقيقياً) لكن تُعلَّم في
// تقرير التدقيق كملاحظة جودة محتوى.
const GENERIC_DESCRIPTION_TEMPLATES = new Set([
  "قطعة غيار للثلاجات، متوفرة بثمن الجملة.",
  "قطعة غيار للثلاجات والتبريد، متوفرة بثمن الجملة.",
  "قطعة غيار للمكيفات المنزلية سبليت، متوفرة بثمن الجملة.",
  "قطعة غيار لآلات غسيل الملابس العادية، متوفرة بثمن الجملة.",
]);

export type MetaCatalogRow = {
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
  inventory: number;
  item_group_id: string;
};

export type AuditIssue = {
  sku: string;
  name_ar: string;
  category_name_ar: string;
  issue_type:
    | "MISSING_DESCRIPTION"
    | "GENERIC_DESCRIPTION"
    | "UNSUITABLE_PRIMARY_IMAGE"
    | "HIDDEN_STATUS"
    | "ZERO_STOCK";
  detail: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  included_in_feed: "yes" | "no";
};

export type CatalogExportResult = {
  rows: MetaCatalogRow[];
  issues: AuditIssue[];
  totalProducts: number;
  excludedFromFeed: number;
  siteUrlConfigured: boolean;
};

function priceString(amount: string | number): string {
  return `${Number(amount).toFixed(2)} ${CURRENCY}`;
}

function absoluteUrl(siteUrl: string | null, path: string): string {
  return siteUrl ? `${siteUrl}${path}` : path;
}

export async function buildCatalogExport(): Promise<CatalogExportResult> {
  const [products, variants] = await Promise.all([
    getAllProductsForExport(),
    getAllVariantsForExport(),
  ]);

  const siteUrl = getSiteUrl();
  const variantsByProduct = new Map<number, CatalogProductVariant[]>();
  for (const variant of variants) {
    const list = variantsByProduct.get(variant.product_id) ?? [];
    list.push(variant);
    variantsByProduct.set(variant.product_id, list);
  }

  const rows: MetaCatalogRow[] = [];
  const issues: AuditIssue[] = [];
  let excludedFromFeed = 0;

  for (const product of products) {
    const isPublished = product.status === "published" || product.status === "out_of_stock";
    const unsuitableImage = UNSUITABLE_PRIMARY_IMAGE_SKUS.has(product.sku);

    if (product.status !== "published" && product.status !== "out_of_stock") {
      issues.push({
        sku: product.sku,
        name_ar: product.name_ar,
        category_name_ar: product.category_name_ar,
        issue_type: "HIDDEN_STATUS",
        detail: `الحالة الحالية: ${product.status} — غير مُدرَج في الخلاصة (الخلاصة تضم فقط المنتجات المنشورة).`,
        severity: "info",
        included_in_feed: "no",
      });
    }

    if (!product.description_ar) {
      issues.push({
        sku: product.sku,
        name_ar: product.name_ar,
        category_name_ar: product.category_name_ar,
        issue_type: "MISSING_DESCRIPTION",
        detail: "لا يوجد وصف مختصر إطلاقاً — يُستعمل اسم المنتج بديلاً مؤقتاً في الخلاصة.",
        severity: "medium",
        included_in_feed: isPublished && !unsuitableImage ? "yes" : "no",
      });
    } else if (GENERIC_DESCRIPTION_TEMPLATES.has(product.description_ar)) {
      issues.push({
        sku: product.sku,
        name_ar: product.name_ar,
        category_name_ar: product.category_name_ar,
        issue_type: "GENERIC_DESCRIPTION",
        detail: "وصف عام مشترك مع منتجات أخرى كثيرة، وليس خاصاً بهذا المنتج.",
        severity: "low",
        included_in_feed: isPublished && !unsuitableImage ? "yes" : "no",
      });
    }

    if (unsuitableImage) {
      excludedFromFeed += 1;
      issues.push({
        sku: product.sku,
        name_ar: product.name_ar,
        category_name_ar: product.category_name_ar,
        issue_type: "UNSUITABLE_PRIMARY_IMAGE",
        detail:
          "الصورة الرئيسية لقطة شاشة إعلانية أو شعار مقصوص مشكوك فيه (نفس القائمة في image_manual_review.csv) — مستبعد من الخلاصة حتى يُستبدَل بصورة منتج حقيقية.",
        severity: "high",
        included_in_feed: "no",
      });
      continue;
    }

    if (product.stock_quantity <= 0) {
      issues.push({
        sku: product.sku,
        name_ar: product.name_ar,
        category_name_ar: product.category_name_ar,
        issue_type: "ZERO_STOCK",
        detail: "المخزون صفر — سيظهر في الخلاصة بحالة (out of stock) وليس مستبعداً.",
        severity: "info",
        included_in_feed: isPublished ? "yes" : "no",
      });
    }

    if (!isPublished) {
      excludedFromFeed += 1;
      continue;
    }

    const productVariants = variantsByProduct.get(product.id) ?? [];
    const link = absoluteUrl(siteUrl, `/product/${product.slug}`);
    const imageLink = product.primary_image_path
      ? absoluteUrl(siteUrl, resolveImageUrl(product.primary_image_path))
      : "";
    const description = product.description_ar ?? product.name_ar;
    const productType = product.category_name_ar;

    if (productVariants.length === 0) {
      rows.push({
        id: product.sku,
        title: product.name_ar,
        description,
        availability: product.stock_quantity > 0 ? "in stock" : "out of stock",
        condition: "new",
        price: priceString(product.sale_price),
        link,
        image_link: imageLink,
        brand: STORE_BRAND,
        product_type: productType,
        inventory: product.stock_quantity,
        item_group_id: "",
      });
    } else {
      for (const variant of productVariants) {
        rows.push({
          id: `${product.sku}-${variant.id}`,
          title: `${product.name_ar} — ${variant.variant_name}`,
          description,
          availability: variant.stock_quantity > 0 ? "in stock" : "out of stock",
          condition: "new",
          price: priceString(variant.sale_price),
          link,
          image_link: imageLink,
          brand: STORE_BRAND,
          product_type: productType,
          inventory: variant.stock_quantity,
          item_group_id: product.sku,
        });
      }
    }
  }

  return {
    rows,
    issues,
    totalProducts: products.length,
    excludedFromFeed,
    siteUrlConfigured: Boolean(siteUrl),
  };
}

const CSV_COLUMNS: (keyof MetaCatalogRow)[] = [
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
  "inventory",
  "item_group_id",
];

function csvEscape(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(rows: MetaCatalogRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
