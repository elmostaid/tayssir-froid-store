import { describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { getProducts } from "@/lib/queries/catalog";

// اختبار ضد ظهور ثمن الشراء في أي مكان عام. لا يعتمد على منتج معيّن —
// يتحقق من عمود قاعدة البيانات نفسه (مخطط catalog_products) ومن نتيجة
// استعلام catalog_products الفعلي المُستعمل في صفحات الموقع العامة.
describe("catalog_products — ثمن الشراء لا يظهر أبداً للزوار", () => {
  test("عرض catalog_products لا يحتوي عمود purchase_price إطلاقاً", async () => {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'catalog_products'
    `;
    const columnNames = columns.map((c) => c.column_name);
    expect(columnNames).not.toContain("purchase_price");
  });

  test("استعلام getProducts() المستعمل في الواجهة العامة لا يرجع purchase_price", async () => {
    const products = await getProducts({ limit: 10 });
    expect(products.length).toBeGreaterThan(0);
    for (const product of products) {
      expect(Object.prototype.hasOwnProperty.call(product, "purchase_price")).toBe(false);
    }
  });
});
