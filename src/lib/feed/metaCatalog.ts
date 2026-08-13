import { getAllProductsForExport, getAllVariantsForExport } from "@/lib/queries/catalogExport";
import { resolveImageUrl } from "@/lib/images";
import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";
import { getSiteUrl } from "@/lib/siteUrl";
import type { CatalogProductVariant } from "@/lib/types";

const STORE_BRAND = "Tayssir Froid";
const CURRENCY = "MAD";

// SKUs التي صورتها الرئيسية غير مناسبة لكتالوج Meta (لقطة شاشة إعلانية
// كاملة فيها ثمن/واجهة هاتف، أو شعار جزئي مشكوك فيه) — نفس قائمة
// image_manual_review.csv في جذر المشروع بالضبط. حدِّث هذه القائمة إذا
// تغيّر ذلك الملف (صور جديدة أو صور أُصلحت).
const UNSUITABLE_PRIMARY_IMAGE_SKUS = new Set<string>([]);

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
    | "HIDDEN_CATEGORY"
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

// path قد يكون مساراً محلياً نسبياً ("/product-images/...") أو رابطاً
// مطلقاً جاهزاً بالفعل (Supabase Storage public URL) — لا نُلحق siteUrl إذا
// كان مطلقاً أصلاً، وإلا ننتج رابطاً مكسوراً (siteUrl + رابط https كامل).
function absoluteUrl(siteUrl: string | null, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return siteUrl ? `${siteUrl}${path}` : path;
}

export async function buildCatalogExport(): Promise<CatalogExportResult> {
  const [products, variants] = await Promise.all([
    getAllProductsForExport(),
    getAllVariantsForExport(),
  ]);

  const siteUrl = getSiteUrl();
  // نفس المصدر المركزي resolveProductImageUrls (محلي للصور القديمة، أو
  // Supabase Storage الحقيقي للصور المرفوعة حديثاً) — يُحل دفعة واحدة قبل
  // الحلقة بدل استدعاء متزامن قديم per-row كان يفترض مساراً محلياً دائماً.
  const imageUrlByPath = await resolveProductImageUrls(
    products.map((p) => p.primary_image_path).filter((p): p is string => Boolean(p))
  );
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
    // category_is_active غائب فقط عن البيانات المحلية الاحتياطية
    // (previewCatalog، لا تصنيفات مخفية فيها أصلاً) — نعتبره ظاهراً حينها.
    const categoryVisible = product.category_is_active !== false;
    const isPublished =
      (product.status === "published" || product.status === "out_of_stock") && categoryVisible;
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
    } else if (!categoryVisible) {
      issues.push({
        sku: product.sku,
        name_ar: product.name_ar,
        category_name_ar: product.category_name_ar,
        issue_type: "HIDDEN_CATEGORY",
        detail: "تصنيف المنتج مخفي من الموقع — غير مُدرَج في الخلاصة حتى يُنشَر التصنيف.",
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
      ? absoluteUrl(
          siteUrl,
          imageUrlByPath[product.primary_image_path] ?? resolveImageUrl(product.primary_image_path)
        )
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

// ملاحظة مهمة: جُرِّب سابقاً إضافة UTF-8 BOM (U+FEFF) في بداية الملف لإصلاح
// ظهور العربية مشوَّهة عند فتح الملف يدوياً في Excel. لكن هذا الملف مصدره
// الأساسي والحرج هو استيراد آلي عبر Meta Commerce Manager (وليس فتح يدوي في
// Excel) — وبعد نشر BOM فشل استيراد Meta بالكامل برسالة "تعذّر التعرّف على
// صيغة الملف"، لأن محلِّل Meta على الأرجح لا يتجاهل BOM كما تفعل معظم أدوات
// CSV القياسية (يُلحَق BOM حرفياً بأول عمود، فيصبح اسمه "﻿id" بدل "id"
// فيفشل التعرّف على العمود بالكامل). صحة الاستيراد الآلي في Meta أهم من
// المعاينة اليدوية في Excel لهذا الملف تحديداً — فلا BOM هنا. الترميز يبقى
// UTF-8 حقيقياً وسليماً 100% (البايتات صحيحة، والترويسة Content-Type تصرّح
// بـcharset=utf-8 صراحة)، فقط بدون علامة BOM القابلة لكسر المحلِّلات الصارمة.
export function rowsToCsv(rows: MetaCatalogRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
