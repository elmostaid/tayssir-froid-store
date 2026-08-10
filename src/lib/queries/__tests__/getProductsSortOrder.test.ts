import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { getProducts } from "@/lib/queries/catalog";

// يتحقق أن getProducts (الاستعلام الحقيقي الذي تستعمله صفحة التصنيف للزبون،
// /category/[slug]) تعتمد sort_order اليدوي أولاً بالضبط كما تفعل
// moveProductUp/moveProductDown فـ/admin/products — أي تبديل فاللوحة يظهر
// مباشرة بنفس الترتيب هنا، بلا حاجة لتشغيل خادم Next.js فعلي.
let categoryId: number;
let categorySlug: string;
let productLow: number; // sort_order = 1 → يجب أن يظهر أولاً
let productMid: number; // sort_order = 2
let productHigh: number; // sort_order = 3 → يجب أن يظهر أخيراً

beforeAll(async () => {
  categorySlug = "test-fixture-catalog-sort-order-category";
  const [category] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values (${categorySlug}, 'تصنيف اختبار ترتيب عرض الزبون', true)
    on conflict (slug) do update set is_active = true
    returning id
  `;
  categoryId = category.id;

  await sql`delete from public.products where sku like 'TEST-FIXTURE-CATSORT-%'`;

  const [low] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
    ) values (
      'TEST-FIXTURE-CATSORT-LOW', 'test-fixture-catsort-low', ${categoryId},
      'منتج ترتيبه 1', 'قطعة', 1, 1, 10.00, 5, 'published', 1
    ) returning id
  `;
  productLow = low.id;

  const [mid] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
    ) values (
      'TEST-FIXTURE-CATSORT-MID', 'test-fixture-catsort-mid', ${categoryId},
      'منتج ترتيبه 2', 'قطعة', 1, 1, 10.00, 5, 'published', 2
    ) returning id
  `;
  productMid = mid.id;

  const [high] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
    ) values (
      'TEST-FIXTURE-CATSORT-HIGH', 'test-fixture-catsort-high', ${categoryId},
      'منتج ترتيبه 3', 'قطعة', 1, 1, 10.00, 5, 'published', 3
    ) returning id
  `;
  productHigh = high.id;
});

afterAll(async () => {
  await sql`delete from public.products where sku like 'TEST-FIXTURE-CATSORT-%'`;
  await sql`delete from public.categories where slug = ${categorySlug}`;
});

describe("getProducts (Category Page الحقيقية) تعتمد sort_order اليدوي أولاً", () => {
  test("الترتيب الافتراضي (sort=newest/بلا تحديد) يطابق sort_order تصاعدياً بالضبط", async () => {
    const products = await getProducts({ categorySlug });
    const ids = products.map((p) => p.id);
    expect(ids).toEqual([productLow, productMid, productHigh]);
  });

  test("بعد تبديل يدوي (محاكاة زر '↑'/'↓')، getProducts تعكس الترتيب الجديد فوراً", async () => {
    // نفس ما تفعله moveProductUp/moveProductDown بالضبط: تبديل قيمتَي
    // sort_order بين منتجَين متجاورَين — بلا استدعاء الإجراء نفسه هنا لأنه
    // يحتاج جلسة إدارة، فقط لإثبات أن getProducts تقرأ العمود فوراً.
    await sql`update public.products set sort_order = 2 where id = ${productLow}`;
    await sql`update public.products set sort_order = 1 where id = ${productMid}`;

    const products = await getProducts({ categorySlug });
    const ids = products.map((p) => p.id);
    expect(ids).toEqual([productMid, productLow, productHigh]);

    // إعادة الحالة الأصلية.
    await sql`update public.products set sort_order = 1 where id = ${productLow}`;
    await sql`update public.products set sort_order = 2 where id = ${productMid}`;
  });

  test("اختيار ترتيب صريح آخر (الثمن/الاسم) يبقى كما هو، بلا تأثير من sort_order", async () => {
    // الثلاثة بنفس الثمن (10.00) هنا — فقط نتأكد أن الاستعلام يستعمل sale_price
    // فعلاً (لا يتجاهله لصالح sort_order) بضبط أثمنة مختلفة مؤقتاً.
    await sql`update public.products set sale_price = 30.00 where id = ${productLow}`;
    await sql`update public.products set sale_price = 20.00 where id = ${productMid}`;
    await sql`update public.products set sale_price = 10.00 where id = ${productHigh}`;

    const products = await getProducts({ categorySlug, sort: "price_asc" });
    const ids = products.map((p) => p.id);
    expect(ids).toEqual([productHigh, productMid, productLow]);

    await sql`update public.products set sale_price = 10.00 where id = ${productLow}`;
    await sql`update public.products set sale_price = 10.00 where id = ${productMid}`;
    await sql`update public.products set sale_price = 10.00 where id = ${productHigh}`;
  });
});
