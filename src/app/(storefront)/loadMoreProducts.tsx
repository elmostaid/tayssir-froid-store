"use server";

import { getProducts, getProductIdsWithVariants, type ProductSort } from "@/lib/queries/catalog";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { ProductCard } from "@/components/ProductCard";
import { safeQuery } from "@/lib/safeQuery";

/**
 * دفعة إضافية من منتجات الصفحة الرئيسية، تُطلب عند ضغط "عرض المزيد".
 *
 * تُرجع الكروت **مُصيَّرة من الخادم** لا بيانات خام، عمداً: ProductCard مكوّن
 * خادمي async (ينتظر resolveProductImageUrl لحلّ رابط الصورة من Supabase
 * Storage)، فلا يمكن تصييره داخل مكوّن عميل. إعادة العناصر نفسها تضمن أن
 * الدفعات التالية **نفس الكروت بالضبط** بنفس منطق الصورة والسعر وزر الإضافة
 * للسلة — بلا أي نسخة ثانية من الكارت تتفرّع عن الأصل مع الوقت.
 *
 * لا تمسّ هذه الدالة أي منطق سلة أو Checkout أو واتساب: هي قراءة فقط، وتمرّ
 * على نفس getProducts المُخزَّن مؤقتاً (بإزاحة) الذي تستعمله بقية الصفحات.
 */
export type LoadMoreFilters = {
  categorySlug?: string;
  query?: string;
  sort?: ProductSort;
};

export async function loadMoreProducts(
  offset: number,
  pageSize: number,
  // فلاتر صفحة التصنيف (تصنيف/بحث/ترتيب). غيابها = الصفحة الرئيسية، أي
  // نفس السلوك السابق بالحرف — الصفحة الرئيسية تستدعيها بلا هذا المعامل.
  filters: LoadMoreFilters = {}
) {
  // نطلب عنصراً زائداً واحداً بدل استعلام عدّ منفصل: وجوده يعني أن هناك
  // دفعة تالية، ثم نتجاهله عند العرض. استعلام واحد بدل اثنين.
  const [batch, variantProductIds, settings] = await Promise.all([
    safeQuery(
      () =>
        getProducts({
          limit: pageSize + 1,
          offset,
          categorySlug: filters.categorySlug,
          query: filters.query,
          sort: filters.sort,
        }),
      [],
      filters.categorySlug ? "category.loadMoreProducts" : "home.loadMoreProducts"
    ),
    safeQuery(
      () => getProductIdsWithVariants(),
      new Set<number>(),
      "home.loadMoreProducts.variants"
    ),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "home.loadMoreProducts.settings"),
  ]);

  const hasMore = batch.length > pageSize;
  const products = hasMore ? batch.slice(0, pageSize) : batch;

  return {
    hasMore,
    nextOffset: offset + products.length,
    cards: products.map((product) => (
      <ProductCard
        key={product.id}
        product={product}
        imageUrl={product.primary_image_path}
        hasVariants={variantProductIds.has(product.id)}
        whatsappNumber={settings.whatsappNumber}
      />
    )),
  };
}
