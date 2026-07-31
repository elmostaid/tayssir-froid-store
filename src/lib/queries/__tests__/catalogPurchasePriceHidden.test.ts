import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { getProducts } from "@/lib/queries/catalog";

// اختبار ضد ظهور ثمن الشراء في أي مكان عام. الجزء الأول يتحقق من عمود
// قاعدة البيانات نفسه (مخطط catalog_products) بغض النظر عن وجود منتجات.
// الجزء الثاني يحتاج منتجاً واحداً منشوراً فعلياً ليتحقق من نتيجة
// getProducts() الفعلية، فيُنشئ منتج اختبار مؤقتاً (يُحذف بعد الاختبار).
const TEST_SKU = "TEST-FIXTURE-PPH-001";

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      ${TEST_SKU}, 'test-fixture-purchase-price-hidden', ${category.id}, 'منتج اختبار مؤقت',
      'قطعة', 1, 1, 50.00, 100.00, 10, 'published'
    )
    on conflict (sku) do nothing
  `;
});

afterAll(async () => {
  await sql`delete from public.products where sku = ${TEST_SKU}`;
});

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
