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

export function getPreviewProducts(
  options: { categorySlug?: string; limit?: number } = {}
): CatalogProduct[] {
  const { categorySlug, limit = 60 } = options;
  const filtered = categorySlug
    ? previewProducts.filter((product) => product.category_slug === categorySlug)
    : previewProducts;
  return filtered.slice(0, limit);
}

export function getPreviewProductBySlug(slug: string): CatalogProduct | null {
  return previewProducts.find((product) => product.slug === slug) ?? null;
}

export function getPreviewProductVariants(productId: number): CatalogProductVariant[] {
  return previewProductVariants
    .filter((variant) => variant.product_id === productId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function getPreviewProductImages(productId: number): CatalogProductImage[] {
  return previewProductImages
    .filter((image) => image.product_id === productId)
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.sort_order - b.sort_order;
    });
}
