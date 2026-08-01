import adminPurchasePricesData from "@/lib/data/preview/adminPurchasePrices.json";

/**
 * ثمن الشراء سري وللإدارة فقط. هذا الملف يقابل، لبيانات fallback المحلية
 * (بدون DATABASE_URL)، عمود purchase_price المحمي بـRLS في جدول
 * public.products الحقيقي — بنفس المبدأ: لا وجود له إطلاقاً في
 * src/lib/data/preview/products.json ولا في src/lib/previewCatalog.ts
 * ولا في أي مسار يقرأه الزبون (الصفحة الرئيسية، صفحة المنتج، السلة،
 * الطلب، أو أي API عام).
 *
 * ممنوع استيراد هذا الملف من أي مكوّن أو صفحة داخل storefront/preview/cart/
 * checkout/order، أو من أي route handler عام. استعمله فقط من كود إداري
 * صريح (مثلاً صفحة إدارة مستقبلية تعرض ثمن الشراء بعد التحقق من
 * requireAdmin).
 */

type PurchasePriceEntry = { sku: string; purchase_price: string };

const purchasePricesBySku = new Map<string, string>(
  (adminPurchasePricesData as PurchasePriceEntry[]).map((row) => [
    row.sku,
    row.purchase_price,
  ])
);

export function getPurchasePriceBySku(sku: string): string | null {
  return purchasePricesBySku.get(sku) ?? null;
}

export function getAllPurchasePrices(): PurchasePriceEntry[] {
  return adminPurchasePricesData as PurchasePriceEntry[];
}
