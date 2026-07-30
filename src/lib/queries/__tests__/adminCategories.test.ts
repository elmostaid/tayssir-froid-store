import { afterEach, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { countChildCategories, countProductsInCategory } from "@/lib/queries/adminCategories";

// deleteCategory (Server Action) يمنع الحذف بالاعتماد على هاتين الدالتين —
// هذا الاختبار يتحقق من منطق العد نفسه ضد قاعدة بيانات حقيقية، لأن حذف
// التصنيف الأب في قاعدة البيانات (parent_id ... on delete set null) لا
// يمنع الحذف تلقائياً؛ منع الحذف مسؤولية طبقة التطبيق فقط.

let createdCategoryIds: number[] = [];
let createdProductIds: number[] = [];

afterEach(async () => {
  if (createdProductIds.length > 0) {
    await sql`delete from public.products where id = any(${createdProductIds})`;
    createdProductIds = [];
  }
  if (createdCategoryIds.length > 0) {
    await sql`delete from public.categories where id = any(${createdCategoryIds})`;
    createdCategoryIds = [];
  }
});

describe("countProductsInCategory / countChildCategories", () => {
  test("يرجع صفراً لتصنيف فارغ بدون منتجات ولا فروع", async () => {
    const [category] = await sql<{ id: number }[]>`
      insert into public.categories (slug, name_ar) values ('test-empty-cat', 'تصنيف اختبار فارغ')
      returning id
    `;
    createdCategoryIds.push(category.id);

    expect(await countProductsInCategory(category.id)).toBe(0);
    expect(await countChildCategories(category.id)).toBe(0);
  });

  test("يكتشف وجود منتج داخل التصنيف فيمنع الحذف منطقياً", async () => {
    const [category] = await sql<{ id: number }[]>`
      insert into public.categories (slug, name_ar) values ('test-cat-with-product', 'تصنيف فيه منتج')
      returning id
    `;
    createdCategoryIds.push(category.id);

    const [product] = await sql<{ id: number }[]>`
      insert into public.products (sku, slug, category_id, name_ar, sale_price)
      values ('TEST-SKU-001', 'test-product-001', ${category.id}, 'منتج اختبار', 100)
      returning id
    `;
    createdProductIds.push(product.id);

    expect(await countProductsInCategory(category.id)).toBe(1);
  });

  test("يكتشف وجود تصنيف فرعي فيمنع الحذف منطقياً", async () => {
    const [parent] = await sql<{ id: number }[]>`
      insert into public.categories (slug, name_ar) values ('test-parent-cat', 'تصنيف أب اختبار')
      returning id
    `;
    createdCategoryIds.push(parent.id);

    const [child] = await sql<{ id: number }[]>`
      insert into public.categories (slug, name_ar, parent_id)
      values ('test-child-cat', 'تصنيف فرعي اختبار', ${parent.id})
      returning id
    `;
    createdCategoryIds.push(child.id);

    expect(await countChildCategories(parent.id)).toBe(1);
  });
});
