import "server-only";
import adminPurchasePricesData from "@/lib/data/preview/adminPurchasePrices.json";

/**
 * ثمن الشراء سري وللإدارة فقط. لا يظهر أبداً في src/lib/data/preview/products.json
 * ولا في src/lib/previewCatalog.ts ولا في أي مسار يقرأه الزبون (الصفحة
 * الرئيسية، صفحة المنتج، السلة، الطلب، أو أي API عام).
 *
 * "server-only" يجعل أي استيراد لهذا الملف من مكوّن عميل ("use client")
 * يفشل عند البناء (compile error) بدل أن يتسرّب صامتاً إلى حزمة المتصفح.
 * استعمله فقط من كود إداري صريح.
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
