import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { listProductsAdmin } from "@/lib/queries/adminProducts";

let categoryId: number;
let productId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  categoryId = category.id;

  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-SEARCH-XYZ', 'test-fixture-search-xyz', ${categoryId},
      'ضاغط اختبار بحث فريد', 'قطعة', 1, 1, 100.00, 200.00, 3, 'published'
    )
    on conflict (sku) do update set stock_quantity = 3, status = 'published'
    returning id
  `;
  productId = product.id;
});

afterAll(async () => {
  await sql`delete from public.products where sku = 'TEST-FIXTURE-SEARCH-XYZ'`;
});

describe("listProductsAdmin — بحث وفلترة قائمة /admin/products", () => {
  test("يجد المنتج بالبحث عن جزء من SKU", async () => {
    const rows = await listProductsAdmin({ query: "SEARCH-XYZ" });
    expect(rows.some((r) => r.id === productId)).toBe(true);
  });

  test("يجد المنتج بالبحث عن جزء من الاسم العربي", async () => {
    const rows = await listProductsAdmin({ query: "بحث فريد" });
    expect(rows.some((r) => r.id === productId)).toBe(true);
  });

  test("لا يجد شيئاً لبحث غير مطابق", async () => {
    const rows = await listProductsAdmin({ query: "XYZ-NONEXISTENT-QUERY-123" });
    expect(rows).toHaveLength(0);
  });

  test("فلترة حسب التصنيف تُرجع المنتج ضمن نفس التصنيف", async () => {
    const rows = await listProductsAdmin({ query: "SEARCH-XYZ", categoryId });
    expect(rows.some((r) => r.id === productId)).toBe(true);
  });

  test("فلترة حسب تصنيف مختلف لا تُرجع المنتج", async () => {
    const [otherCategory] = await sql<{ id: number }[]>`
      select id from public.categories where id != ${categoryId} limit 1
    `;
    if (!otherCategory) return; // بيئة بدون تصنيف ثانٍ — يتخطّى بأمان
    const rows = await listProductsAdmin({ query: "SEARCH-XYZ", categoryId: otherCategory.id });
    expect(rows.some((r) => r.id === productId)).toBe(false);
  });

  test("فلترة status='published' تُرجع المنتج (منشور)", async () => {
    const rows = await listProductsAdmin({ query: "SEARCH-XYZ", status: "published" });
    expect(rows.some((r) => r.id === productId)).toBe(true);
  });

  test("فلترة status='draft' لا تُرجع المنتج المنشور", async () => {
    const rows = await listProductsAdmin({ query: "SEARCH-XYZ", status: "draft" });
    expect(rows.some((r) => r.id === productId)).toBe(false);
  });

  test("فلترة المخزون المنخفض تُرجع المنتج (مخزونه 3، أقل من العتبة)", async () => {
    const rows = await listProductsAdmin({ query: "SEARCH-XYZ", lowStockOnly: true });
    expect(rows.some((r) => r.id === productId)).toBe(true);
  });
});
