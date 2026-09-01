import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

// نفس نمط moveProduct.test.ts: getAdminUser() تحتاج جلسة Supabase Auth
// حقيقية غير متاحة فبيئة الاختبار — نُحاكيها هنا فقط.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  // تمرير مباشر: لا تخزين مؤقّت في الاختبارات، فينفَّذ الاستعلام الحقيقي.
  unstable_cache: (fn: unknown) => fn,
}));

const { addFeaturedProduct, removeFeaturedProduct, moveFeaturedToRank } = await import(
  "@/app/admin/(protected)/featured/actions"
);
const { listFeaturedAdmin, searchFeaturableProducts } = await import(
  "@/lib/queries/adminFeatured"
);
const { getFeaturedProducts } = await import("@/lib/queries/catalog");

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

let categoryId: number;
const productIds: number[] = [];
const NAMES = ["غاز فريون واحد", "غاز فريون اثنان", "غاز فريون ثلاثة", "غاز فريون أربعة"];

async function positions(): Promise<{ product_id: number; position: number }[]> {
  return sql<{ product_id: number; position: number }[]>`
    select product_id, position from public.home_featured_products
    order by position asc, product_id asc
  `;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-featured-category', 'تصنيف اختبار الأكثر طلباً', true)
    on conflict (slug) do update set is_active = true
    returning id
  `;
  categoryId = category.id;

  await sql`delete from public.products where sku like 'TEST-FIXTURE-FEATURED-%'`;

  for (let i = 0; i < NAMES.length; i++) {
    const [product] = await sql<{ id: number }[]>`
      insert into public.products (
        sku, slug, category_id, name_ar, unit_label,
        min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
      ) values (
        ${`TEST-FIXTURE-FEATURED-${i + 1}`}, ${`test-fixture-featured-${i + 1}`},
        ${categoryId}, ${NAMES[i]}, 'قطعة', 1, 1, 50, 10, 'published', ${i + 1}
      )
      returning id
    `;
    productIds.push(product.id);
  }
});

beforeEach(async () => {
  await sql`delete from public.home_featured_products`;
  getAdminUserMock.mockReset();
});

afterAll(async () => {
  await sql`delete from public.home_featured_products`;
  await sql`delete from public.products where sku like 'TEST-FIXTURE-FEATURED-%'`;
  await sql`delete from public.categories where slug = 'test-fixture-featured-category'`;
});

async function addAll(count: number) {
  for (let i = 0; i < count; i++) {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await addFeaturedProduct(productIds[i]);
    expect(result.error).toBeNull();
  }
}

describe("اختيار منتجات «الأكثر طلباً»", () => {
  test("الإضافة تلحق بآخر القائمة وترقّمها 1، 2، 3", async () => {
    await addAll(3);

    expect(await positions()).toEqual([
      { product_id: productIds[0], position: 1 },
      { product_id: productIds[1], position: 2 },
      { product_id: productIds[2], position: 3 },
    ]);
  });

  test("إضافة نفس المنتج مرتين لا تُكرّره ولا تُحرّك القائمة", async () => {
    await addAll(2);

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await addFeaturedProduct(productIds[0]);

    expect(result.error).not.toBeNull();
    expect(await positions()).toEqual([
      { product_id: productIds[0], position: 1 },
      { product_id: productIds[1], position: 2 },
    ]);
  });

  test("منتج غير موجود يُرفَض برسالة، لا بخطأ مفتاح أجنبي", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await addFeaturedProduct(-1);

    expect(result.error).not.toBeNull();
    expect(await positions()).toEqual([]);
  });

  test("الإزالة تُغلق الفجوة فلا تبقى مرتبة محذوفة", async () => {
    await addAll(3);

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    expect((await removeFeaturedProduct(productIds[0])).error).toBeNull();

    // الباقيان يصيران 1 و2 — لا 2 و3 بفجوة فالمقدّمة.
    expect(await positions()).toEqual([
      { product_id: productIds[1], position: 1 },
      { product_id: productIds[2], position: 2 },
    ]);
  });

  test("الإزالة لا تحذف المنتج نفسه من الكتالوج", async () => {
    await addAll(1);

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await removeFeaturedProduct(productIds[0]);

    const [product] = await sql<{ status: string; name_ar: string }[]>`
      select status, name_ar from public.products where id = ${productIds[0]}
    `;
    expect(product.status).toBe("published");
    expect(product.name_ar).toBe(NAMES[0]);
  });
});

describe("الترتيب اليدوي بالأرقام", () => {
  test("نقل الأخير إلى المرتبة 1 يُزيح من فوقه واحداً واحداً", async () => {
    await addAll(4);

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    expect((await moveFeaturedToRank(productIds[3], 1)).error).toBeNull();

    expect(await positions()).toEqual([
      { product_id: productIds[3], position: 1 },
      { product_id: productIds[0], position: 2 },
      { product_id: productIds[1], position: 3 },
      { product_id: productIds[2], position: 4 },
    ]);
  });

  test("نقل الأول إلى الوسط لا يمسّ من هم تحت المرتبة الهدف", async () => {
    await addAll(4);

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    expect((await moveFeaturedToRank(productIds[0], 3)).error).toBeNull();

    expect(await positions()).toEqual([
      { product_id: productIds[1], position: 1 },
      { product_id: productIds[2], position: 2 },
      { product_id: productIds[0], position: 3 },
      { product_id: productIds[3], position: 4 },
    ]);
  });

  test("رقم أكبر من طول القائمة يُثبَّت عند آخر مرتبة بدل أن يترك فجوة", async () => {
    await addAll(3);

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    expect((await moveFeaturedToRank(productIds[0], 99)).error).toBeNull();

    expect(await positions()).toEqual([
      { product_id: productIds[1], position: 1 },
      { product_id: productIds[2], position: 2 },
      { product_id: productIds[0], position: 3 },
    ]);
  });

  test("رقم غير صالح يُرفَض قبل أي كتابة", async () => {
    await addAll(2);

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await moveFeaturedToRank(productIds[1], 0);

    expect(result.error).not.toBeNull();
    expect(await positions()).toEqual([
      { product_id: productIds[0], position: 1 },
      { product_id: productIds[1], position: 2 },
    ]);
  });

  test("ترتيب «الأكثر طلباً» مستقل تماماً عن sort_order داخل التصنيف", async () => {
    const before = await sql<{ id: number; sort_order: number }[]>`
      select id, sort_order from public.products
      where category_id = ${categoryId} order by id
    `;

    await addAll(4);
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await moveFeaturedToRank(productIds[3], 1);
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await removeFeaturedProduct(productIds[1]);

    const after = await sql<{ id: number; sort_order: number }[]>`
      select id, sort_order from public.products
      where category_id = ${categoryId} order by id
    `;
    expect(after).toEqual(before);
  });
});

describe("ما تعرضه الصفحة الرئيسية", () => {
  test("getFeaturedProducts تُرجع الاختيار بترتيب المدير لا بترتيب الكتالوج", async () => {
    await addAll(3);
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await moveFeaturedToRank(productIds[2], 1);

    const featured = await getFeaturedProducts();
    const fixtureNames = featured
      .filter((product) => product.sku.startsWith("TEST-FIXTURE-FEATURED-"))
      .map((product) => product.name_ar);

    expect(fixtureNames).toEqual([NAMES[2], NAMES[0], NAMES[1]]);
  });

  test("قائمة فارغة تعني «لم يختر المدير شيئاً» — والصفحة تتراجع للقياس", async () => {
    expect(await getFeaturedProducts()).toEqual([]);
  });

  test("منتج مسودة يبقى فلوحة الإدارة ولا يصل الزبون", async () => {
    await addAll(1);
    await sql`update public.products set status = 'draft' where id = ${productIds[0]}`;

    try {
      const adminRows = await listFeaturedAdmin();
      expect(adminRows.map((row) => row.product_id)).toContain(productIds[0]);

      const shopRows = await getFeaturedProducts();
      expect(shopRows.map((row) => row.id)).not.toContain(productIds[0]);
    } finally {
      await sql`update public.products set status = 'published' where id = ${productIds[0]}`;
    }
  });
});

describe("بحث الإضافة", () => {
  test("لا يعرض ما هو مضاف أصلاً", async () => {
    await addAll(1);

    const results = await searchFeaturableProducts("غاز فريون");
    const ids = results.map((product) => product.id);

    expect(ids).not.toContain(productIds[0]);
    expect(ids).toContain(productIds[1]);
  });

  test("بحث فارغ لا يُرجع الكتالوج كله", async () => {
    expect(await searchFeaturableProducts("   ")).toEqual([]);
  });
});

describe("الصلاحيات", () => {
  test("Staff ممنوع من الإضافة والإزالة والترتيب", async () => {
    await addAll(2);

    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    expect((await addFeaturedProduct(productIds[2])).error).not.toBeNull();
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    expect((await removeFeaturedProduct(productIds[0])).error).not.toBeNull();
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    expect((await moveFeaturedToRank(productIds[1], 1)).error).not.toBeNull();

    expect(await positions()).toEqual([
      { product_id: productIds[0], position: 1 },
      { product_id: productIds[1], position: 2 },
    ]);
  });

  test("زائر بلا حساب ممنوع كذلك", async () => {
    getAdminUserMock.mockResolvedValueOnce(null);
    expect((await addFeaturedProduct(productIds[0])).error).not.toBeNull();
    expect(await positions()).toEqual([]);
  });
});
