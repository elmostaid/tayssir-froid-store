import categoriesData from "@/lib/data/preview/categories.json";
import productsData from "@/lib/data/preview/products.json";
import productVariantsData from "@/lib/data/preview/productVariants.json";
import productImagesData from "@/lib/data/preview/productImages.json";
import type {
  Category,
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductImage,
} from "@/lib/types";

// بيانات ثابتة مأخوذة من المنتجات والصور المنشورة حالياً في المشروع (بدون
// أي اتصال بقاعدة البيانات)، تُستعمل فقط في مسارات /preview لمعاينة الموقع.

const previewCategories = categoriesData as Category[];
const previewProducts = productsData as CatalogProduct[];
const previewProductVariants = productVariantsData as CatalogProductVariant[];
const previewProductImages = productImagesData as CatalogProductImage[];

// تصنيفات "فارغة" (بدون أي منتج بحالة "published") تبقى موجودة في البيانات
// لكن تُخفى عن الزبون هنا فقط — لا نحذفها، ونحسب الفراغ ديناميكياً من
// المنتجات الحالية في كل مرة (فمجرد إضافة أول منتج منشور لتصنيف يُظهره
// تلقائياً بلا أي تعديل يدوي إضافي).
function getCategoryIdsWithPublishedProducts(): Set<number> {
  const ids = new Set<number>();
  for (const product of previewProducts) {
    if (product.status === "published") {
      ids.add(product.category_id);
    }
  }
  return ids;
}

export function getPreviewCategories(): Category[] {
  const visibleIds = getCategoryIdsWithPublishedProducts();
  return previewCategories.filter((category) => visibleIds.has(category.id));
}

export function getPreviewCategoryBySlug(slug: string): Category | null {
  return previewCategories.find((category) => category.slug === slug) ?? null;
}

export function getPreviewProductCountsByCategory(): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const product of previewProducts) {
    if (product.status !== "published") continue;
    counts[product.category_id] = (counts[product.category_id] ?? 0) + 1;
  }
  return counts;
}

export type ProductSort = "newest" | "price_asc" | "price_desc" | "name";

export function getPreviewProducts(
  options: {
    categorySlug?: string;
    limit?: number;
    query?: string;
    sort?: ProductSort;
  } = {}
): CatalogProduct[] {
  const { categorySlug, limit = 60, query, sort = "newest" } = options;
  let filtered = categorySlug
    ? previewProducts.filter((product) => product.category_slug === categorySlug)
    : previewProducts.slice();

  const needle = query?.trim().toLowerCase();
  if (needle) {
    filtered = filtered.filter((product) => {
      const haystacks = [product.name_ar, product.name_fr, product.sku, product.description_ar];
      return haystacks.some(
        (value) => typeof value === "string" && value.toLowerCase().includes(needle)
      );
    });
  }

  const sorted = sortPreviewProducts(filtered, sort);
  return sorted.slice(0, limit);
}

function sortPreviewProducts(products: CatalogProduct[], sort: ProductSort): CatalogProduct[] {
  const list = products.slice();
  switch (sort) {
    case "price_asc":
      return list.sort((a, b) => Number(a.sale_price) - Number(b.sale_price));
    case "price_desc":
      return list.sort((a, b) => Number(b.sale_price) - Number(a.sale_price));
    case "name":
      return list.sort((a, b) => a.name_ar.localeCompare(b.name_ar, "ar"));
    case "newest":
    default:
      // بيانات fallback مرتَّبة أصلاً من الأحدث؛ id أكبر = أُضيف لاحقاً
      return list.sort((a, b) => b.id - a.id);
  }
}

// بحث بسيط بمطابقة جزء من النص (بدون حساسية لحالة الأحرف) عبر الحقول التي
// قد تحتوي الاسم بالعربية أو الفرنسية أو SKU أو الماركة/الموديل (المدمَجة
// عادة داخل الاسم أو الوصف لعدم وجود حقول brand/model منفصلة في البيانات).
export function searchPreviewProducts(
  query: string,
  limit = 60
): CatalogProduct[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return previewProducts
    .filter((product) => {
      const haystacks = [
        product.name_ar,
        product.name_fr,
        product.sku,
        product.slug,
        product.description_ar,
        product.technical_specs,
      ];
      return haystacks.some(
        (value) => typeof value === "string" && value.toLowerCase().includes(needle)
      );
    })
    .slice(0, limit);
}

export function getPreviewProductBySlug(slug: string): CatalogProduct | null {
  return previewProducts.find((product) => product.slug === slug) ?? null;
}

export function getPreviewProductIdsWithVariants(): Set<number> {
  return new Set(previewProductVariants.map((variant) => variant.product_id));
}

export function getPreviewProductVariants(productId: number): CatalogProductVariant[] {
  return previewProductVariants
    .filter((variant) => variant.product_id === productId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

// كل المنتجات بكل الحالات (منشور/غير منشور)، لأغراض التدقيق والتصدير
// الإداري فقط (مثل Meta Commerce Catalog) — وليس لأي صفحة يراها الزبون.
export function getAllPreviewProductsForExport(): CatalogProduct[] {
  return previewProducts.slice();
}

export function getAllPreviewVariantsForExport(): CatalogProductVariant[] {
  return previewProductVariants.slice();
}

// كل صور كل المنتجات (وليس فقط منتج واحد)، لأغراض التصدير/الخلاصة فقط
// (مثل additional_image_link في Meta Commerce Catalog).
export function getAllPreviewProductImagesForExport(): CatalogProductImage[] {
  return previewProductImages.slice();
}

export function getPreviewProductImages(productId: number): CatalogProductImage[] {
  return previewProductImages
    .filter((image) => image.product_id === productId)
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.sort_order - b.sort_order;
    });
}
