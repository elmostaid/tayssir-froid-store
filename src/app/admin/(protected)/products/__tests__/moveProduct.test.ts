import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

// نفس نمط quickUpdateProduct.test.ts: getAdminUser() تحتاج جلسة Supabase Auth
// حقيقية غير متاحة فبيئة الاختبار — نُحاكيها هنا فقط.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { moveProductUp, moveProductDown, moveProductToRank } = await import(
  "@/app/admin/(protected)/products/actions"
);

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

// تصنيف اختبار مخصَّص ومعزول تماماً: منطق "أول/آخر منتج فالتصنيف" يعتمد على
// *كل* منتجات نفس category_id، فلا يمكن اختباره بدقة داخل تصنيف حقيقي فيه
// منتجات أخرى غير معروفة للاختبار.
let categoryId: number;
let productA: number; // rank 1 (الأول)
let productB: number; // rank 2
let productC: number; // rank 3 (الأخير)
let otherCategoryId: number;
let otherCategoryProductId: number;

async function currentOrder(): Promise<{ id: number; sort_order: number }[]> {
  return sql<{ id: number; sort_order: number }[]>`
    select id, sort_order from public.products
    where category_id = ${categoryId}
    order by sort_order asc, created_at desc, id desc
  `;
}

async function assertProductFieldsUnchanged(productId: number, expectedName: string) {
  const [product] = await sql<
    { name_ar: string; sale_price: string; stock_quantity: number; sku: string; status: string }[]
  >`select name_ar, sale_price, stock_quantity, sku, status from public.products where id = ${productId}`;
  expect(product.name_ar).toBe(expectedName);
  expect(Number(product.sale_price)).toBe(50);
  expect(product.stock_quantity).toBe(10);
  expect(product.status).toBe("published");
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-move-product-category', 'تصنيف اختبار ترتيب المنتجات', true)
    on conflict (slug) do update set is_active = true
    returning id
  `;
  categoryId = category.id;

  const [other] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-move-product-other-category', 'تصنيف اختبار آخر', true)
    on conflict (slug) do update set is_active = true
    returning id
  `;
  otherCategoryId = other.id;

  await sql`delete from public.products where sku like 'TEST-FIXTURE-MOVE-%'`;

  const [a] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
    ) values (
      'TEST-FIXTURE-MOVE-A', 'test-fixture-move-a', ${categoryId},
      'منتج أ (الأول)', 'قطعة', 1, 1, 50.00, 10, 'published', 1
    ) returning id
  `;
  productA = a.id;

  const [b] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
    ) values (
      'TEST-FIXTURE-MOVE-B', 'test-fixture-move-b', ${categoryId},
      'منتج ب (الوسط)', 'قطعة', 1, 1, 50.00, 10, 'published', 2
    ) returning id
  `;
  productB = b.id;

  const [c] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
    ) values (
      'TEST-FIXTURE-MOVE-C', 'test-fixture-move-c', ${categoryId},
      'منتج ج (الأخير)', 'قطعة', 1, 1, 50.00, 10, 'published', 3
    ) returning id
  `;
  productC = c.id;

  const [otherProduct] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
    ) values (
      'TEST-FIXTURE-MOVE-OTHER', 'test-fixture-move-other', ${otherCategoryId},
      'منتج فتصنيف آخر', 'قطعة', 1, 1, 999.00, 20, 'published', 1
    ) returning id
  `;
  otherCategoryProductId = otherProduct.id;
});

afterEach(async () => {
  // إعادة الترتيب الأصلي (أ=1، ب=2، ج=3) بين الاختبارات.
  await sql`update public.products set sort_order = 1 where id = ${productA}`;
  await sql`update public.products set sort_order = 2 where id = ${productB}`;
  await sql`update public.products set sort_order = 3 where id = ${productC}`;
  await sql`update public.products set sort_order = 1 where id = ${otherCategoryProductId}`;
});

afterAll(async () => {
  await sql`delete from public.products where sku like 'TEST-FIXTURE-MOVE-%'`;
  await sql`delete from public.categories where slug in ('test-fixture-move-product-category', 'test-fixture-move-product-other-category')`;
});

describe("moveProductUp / moveProductDown — ترتيب المنتجات داخل تصنيفها فقط", () => {
  test("Staff: يُرفَض ولا يتغيّر الترتيب", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const result = await moveProductUp(productB);
    expect(result.error).toBeTruthy();

    const order = await currentOrder();
    expect(order.map((p) => p.id)).toEqual([productA, productB, productC]);
  });

  test("منتج فالوسط: '↑' يبدّله مع سابقه فقط", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await moveProductUp(productB);
    expect(result.error).toBeNull();

    const order = await currentOrder();
    expect(order.map((p) => p.id)).toEqual([productB, productA, productC]);

    // بقية بيانات المنتجَين الثلاثة بلا أي تغيير.
    await assertProductFieldsUnchanged(productA, "منتج أ (الأول)");
    await assertProductFieldsUnchanged(productB, "منتج ب (الوسط)");
    await assertProductFieldsUnchanged(productC, "منتج ج (الأخير)");
  });

  test("منتج فالوسط: '↓' يبدّله مع لاحقه فقط", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await moveProductDown(productB);
    expect(result.error).toBeNull();

    const order = await currentOrder();
    expect(order.map((p) => p.id)).toEqual([productA, productC, productB]);
  });

  test("المنتج الأول: '↑' لا يفعل شيئاً (بلا خطأ، بلا تغيير)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await moveProductUp(productA);
    expect(result.error).toBeNull();

    const order = await currentOrder();
    expect(order.map((p) => p.id)).toEqual([productA, productB, productC]);
  });

  test("المنتج الأخير: '↓' لا يفعل شيئاً (بلا خطأ، بلا تغيير)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await moveProductDown(productC);
    expect(result.error).toBeNull();

    const order = await currentOrder();
    expect(order.map((p) => p.id)).toEqual([productA, productB, productC]);
  });

  test("منتج تصنيف آخر لا يتأثر إطلاقاً عند ترتيب تصنيف هذا الاختبار", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const [before] = await sql<{ sort_order: number }[]>`
      select sort_order from public.products where id = ${otherCategoryProductId}
    `;

    await moveProductUp(productC);

    const [after] = await sql<{ sort_order: number }[]>`
      select sort_order from public.products where id = ${otherCategoryProductId}
    `;
    expect(after.sort_order).toBe(before.sort_order);
  });

  test("تبديلان متتاليان يعيدان المنتج لمكانه الأصلي", async () => {
    // [A,B,C] → طلّع ج (يبدّل مع ب) → [A,C,B] → طلّع ب (أصبح أخيراً، يبدّل
    // مع ج) → [A,B,C] من جديد.
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await moveProductUp(productC);
    expect((await currentOrder()).map((p) => p.id)).toEqual([productA, productC, productB]);

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await moveProductUp(productB);

    const order = await currentOrder();
    expect(order.map((p) => p.id)).toEqual([productA, productB, productC]);
  });

  test("نتيجة النجاح تُرجع المنتجَين اللذين تغيّرت مرتبتهما فعلياً (لتحديث فوري بالواجهة)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await moveProductUp(productB);
    expect(result.updated).toBeTruthy();
    const byId = new Map(result.updated!.map((u) => [u.id, u.sort_order]));
    expect(byId.get(productA)).toBe(2);
    expect(byId.get(productB)).toBe(1);
  });
});

describe("moveProductToRank — نقل مباشر لمرتبة مطلوبة داخل التصنيف (خانة المرتبة + زر نقل)", () => {
  // تصنيف أكبر مخصَّص لهذا الوصف فقط (10 منتجات) لاختبار قفزة كبيرة فمرتبة
  // واحدة (مطابق لسيناريو المستخدم: نقل من مرتبة بعيدة إلى مرتبة قريبة من
  // الأول بعملية واحدة).
  let bigCategoryId: number;
  let bigProducts: number[]; // ids بترتيب المرتبة 1..10

  beforeAll(async () => {
    const [category] = await sql<{ id: number }[]>`
      insert into public.categories (slug, name_ar, is_active)
      values ('test-fixture-move-to-rank-category', 'تصنيف اختبار النقل المباشر', true)
      on conflict (slug) do update set is_active = true
      returning id
    `;
    bigCategoryId = category.id;

    await sql`delete from public.products where sku like 'TEST-FIXTURE-RANK-%'`;

    bigProducts = [];
    for (let i = 1; i <= 10; i++) {
      const [row] = await sql<{ id: number }[]>`
        insert into public.products (
          sku, slug, category_id, name_ar, unit_label,
          min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
        ) values (
          ${"TEST-FIXTURE-RANK-" + i}, ${"test-fixture-rank-" + i}, ${bigCategoryId},
          ${"منتج رقم " + i}, 'قطعة', 1, 1, 50.00, 10, 'published', ${i}
        ) returning id
      `;
      bigProducts.push(row.id);
    }
  });

  afterEach(async () => {
    for (let i = 0; i < bigProducts.length; i++) {
      await sql`update public.products set sort_order = ${i + 1} where id = ${bigProducts[i]}`;
    }
  });

  afterAll(async () => {
    await sql`delete from public.products where sku like 'TEST-FIXTURE-RANK-%'`;
    await sql`delete from public.categories where slug = 'test-fixture-move-to-rank-category'`;
  });

  async function bigCategoryOrder(): Promise<{ id: number; sort_order: number }[]> {
    return sql<{ id: number; sort_order: number }[]>`
      select id, sort_order from public.products
      where category_id = ${bigCategoryId}
      order by sort_order asc, created_at desc, id desc
    `;
  }

  test("Staff: يُرفَض ولا يتغيّر الترتيب", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const result = await moveProductToRank(bigProducts[9], 2);
    expect(result.error).toBeTruthy();

    const order = await bigCategoryOrder();
    expect(order.map((p) => p.id)).toEqual(bigProducts);
  });

  test("رقم مرتبة غير صحيح (0، سالب، عشري): يُرفَض بلا لمس القاعدة", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    let result = await moveProductToRank(bigProducts[0], 0);
    expect(result.error).toBeTruthy();

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    result = await moveProductToRank(bigProducts[0], -3);
    expect(result.error).toBeTruthy();

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    result = await moveProductToRank(bigProducts[0], 1.5);
    expect(result.error).toBeTruthy();

    const order = await bigCategoryOrder();
    expect(order.map((p) => p.id)).toEqual(bigProducts);
  });

  test("نقل منتج من مرتبة 10 إلى مرتبة 2: يعيد ترتيب 1..10 بلا تكرار ولا فراغات، بعملية واحدة", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    // المنتج العاشر (bigProducts[9], مرتبته الحالية 10) → مرتبة 2.
    const result = await moveProductToRank(bigProducts[9], 2);
    expect(result.error).toBeNull();
    expect(result.updated).toBeTruthy();

    const order = await bigCategoryOrder();
    // التسلسل المتوقع: 1(بلا تغيير) ، 10(الجديد فمرتبة 2) ، 2..9 (كل واحد
    // تحرَّك مرتبة واحدة للأسفل ليُفسح المكان).
    expect(order.map((p) => p.id)).toEqual([
      bigProducts[0],
      bigProducts[9],
      bigProducts[1],
      bigProducts[2],
      bigProducts[3],
      bigProducts[4],
      bigProducts[5],
      bigProducts[6],
      bigProducts[7],
      bigProducts[8],
    ]);

    // sort_order متصل تماماً 1..10 بلا تكرار ولا فراغ.
    const sortOrders = order.map((p) => p.sort_order).sort((a, b) => a - b);
    expect(sortOrders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(sortOrders).size).toBe(10);
  });

  test("نقل منتج من مرتبة 1 إلى مرتبة 8: الاتجاه المعاكس يعمل بنفس الصحة", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await moveProductToRank(bigProducts[0], 8);
    expect(result.error).toBeNull();

    const order = await bigCategoryOrder();
    expect(order.map((p) => p.id)).toEqual([
      bigProducts[1],
      bigProducts[2],
      bigProducts[3],
      bigProducts[4],
      bigProducts[5],
      bigProducts[6],
      bigProducts[7],
      bigProducts[0],
      bigProducts[8],
      bigProducts[9],
    ]);

    const sortOrders = order.map((p) => p.sort_order).sort((a, b) => a - b);
    expect(sortOrders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("مرتبة هدف أكبر من عدد المنتجات: تُثبَّت (clamp) عند آخر مرتبة، بلا خطأ", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await moveProductToRank(bigProducts[0], 999);
    expect(result.error).toBeNull();

    const order = await bigCategoryOrder();
    expect(order[order.length - 1].id).toBe(bigProducts[0]);
    const sortOrders = order.map((p) => p.sort_order).sort((a, b) => a - b);
    expect(sortOrders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("نقل لنفس المرتبة الحالية: بلا أي تغيير (updated فارغة أو غير موجودة)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await moveProductToRank(bigProducts[4], 5);
    expect(result.error).toBeNull();
    expect(result.updated ?? []).toHaveLength(0);

    const order = await bigCategoryOrder();
    expect(order.map((p) => p.id)).toEqual(bigProducts);
  });

  test("منتج تصنيف آخر (تصنيف صغير من الوصف السابق) لا يتأثر إطلاقاً", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const [before] = await sql<{ sort_order: number }[]>`
      select sort_order from public.products where id = ${otherCategoryProductId}
    `;

    await moveProductToRank(bigProducts[9], 3);

    const [after] = await sql<{ sort_order: number }[]>`
      select sort_order from public.products where id = ${otherCategoryProductId}
    `;
    expect(after.sort_order).toBe(before.sort_order);
  });

  test("بيانات المنتجات الأخرى (الاسم/الثمن/المخزون/الحالة) بلا أي تغيير بعد النقل", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await moveProductToRank(bigProducts[9], 2);

    const [product] = await sql<
      { name_ar: string; sale_price: string; stock_quantity: number; status: string }[]
    >`select name_ar, sale_price, stock_quantity, status from public.products where id = ${bigProducts[9]}`;
    expect(product.name_ar).toBe("منتج رقم 10");
    expect(Number(product.sale_price)).toBe(50);
    expect(product.stock_quantity).toBe(10);
    expect(product.status).toBe("published");
  });
});
