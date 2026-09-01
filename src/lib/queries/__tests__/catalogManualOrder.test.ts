import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  // تمرير مباشر: لا تخزين مؤقّت في الاختبارات، فينفَّذ الاستعلام الحقيقي.
  unstable_cache: (fn: unknown) => fn,
}));

const { getProducts } = await import("@/lib/queries/catalog");

/**
 * الترتيب اليدوي (sort_order) كما يراه الزبون.
 *
 * العطل الذي أوجب هذه الاختبارات: sort_order رقمٌ **داخل التصنيف** —
 * moveProductToRank يُعيد ترقيم التصنيف 1..N بعد كل نقل، والقياس على
 * الإنتاج أكّده (ثمانية تصنيفات، كل واحد مُرقَّم 1..N على حدة). و«جميع
 * المنتجات» فالصفحة الرئيسية كانت ترتّب بهذا الرقم وحده بلا فلترة تصنيف،
 * فتضع ثمانية منتجات مختلفة كلها تحمل الرقم 1 قبل أي منتج يحمل 2. المدير
 * يضع منتجاً فالمرتبة 1 فلا يراه أولاً — لأن مقارنة أرقام من تصنيفات
 * مختلفة ببعضها لا معنى لها أصلاً.
 */
let firstCategoryId: number;
let secondCategoryId: number;
const FIRST_SKUS = ["TEST-FIXTURE-ORDER-A1", "TEST-FIXTURE-ORDER-A2", "TEST-FIXTURE-ORDER-A3"];
const SECOND_SKUS = ["TEST-FIXTURE-ORDER-B1", "TEST-FIXTURE-ORDER-B2"];

// رقما ترتيب مرتفعان جداً حتى يقع التصنيفان بعد كل تصنيفات القاعدة الأخرى،
// فيبقى الاختبار صحيحاً مهما كان محتوى قاعدة الاختبار.
const FIRST_CATEGORY_SORT = 9001;
const SECOND_CATEGORY_SORT = 9002;

async function insertProduct(
  categoryId: number,
  sku: string,
  sortOrder: number
): Promise<void> {
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
    ) values (
      ${sku}, ${sku.toLowerCase()}, ${categoryId}, ${sku}, 'قطعة',
      1, 1, 50, 10, 'published', ${sortOrder}
    )
  `;
}

/** أكواد المنتجات المُثبَّتة فقط، بترتيب ظهورها الحقيقي للزبون. */
async function fixtureOrder(categorySlug?: string): Promise<string[]> {
  const products = await getProducts({ categorySlug, limit: 500 });
  return products
    .map((product) => product.sku)
    .filter((sku) => sku.startsWith("TEST-FIXTURE-ORDER-"));
}

beforeAll(async () => {
  await sql`delete from public.products where sku like 'TEST-FIXTURE-ORDER-%'`;

  const [first] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active, sort_order)
    values ('test-fixture-order-first', 'تصنيف ترتيب أول', true, ${FIRST_CATEGORY_SORT})
    on conflict (slug) do update set is_active = true, sort_order = ${FIRST_CATEGORY_SORT}
    returning id
  `;
  firstCategoryId = first.id;

  const [second] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active, sort_order)
    values ('test-fixture-order-second', 'تصنيف ترتيب ثانٍ', true, ${SECOND_CATEGORY_SORT})
    on conflict (slug) do update set is_active = true, sort_order = ${SECOND_CATEGORY_SORT}
    returning id
  `;
  secondCategoryId = second.id;

  // كل تصنيف مُرقَّم 1..N على حدة — تماماً كما هو على الإنتاج.
  for (let i = 0; i < FIRST_SKUS.length; i++) {
    await insertProduct(firstCategoryId, FIRST_SKUS[i], i + 1);
  }
  for (let i = 0; i < SECOND_SKUS.length; i++) {
    await insertProduct(secondCategoryId, SECOND_SKUS[i], i + 1);
  }
});

afterAll(async () => {
  await sql`delete from public.products where sku like 'TEST-FIXTURE-ORDER-%'`;
  await sql`delete from public.categories where slug like 'test-fixture-order-%'`;
});

describe("«جميع المنتجات» — الرقم الأصغر يظهر أولاً داخل تصنيفه", () => {
  test("التصنيفات تأتي بترتيب المدير، لا مختلطة برقم المنتج", async () => {
    expect(await fixtureOrder()).toEqual([...FIRST_SKUS, ...SECOND_SKUS]);
  });

  test("تغيير المرتبة من الإدارة ينعكس فالقائمة غير المفلترة", async () => {
    await sql`
      update public.products set sort_order = 1 where sku = ${FIRST_SKUS[2]}
    `;
    await sql`
      update public.products set sort_order = 3 where sku = ${FIRST_SKUS[0]}
    `;

    try {
      expect(await fixtureOrder()).toEqual([
        FIRST_SKUS[2],
        FIRST_SKUS[1],
        FIRST_SKUS[0],
        ...SECOND_SKUS,
      ]);
    } finally {
      await sql`update public.products set sort_order = 3 where sku = ${FIRST_SKUS[2]}`;
      await sql`update public.products set sort_order = 1 where sku = ${FIRST_SKUS[0]}`;
    }
  });

  test("ترتيب التصنيفات نفسه يُحرّك كتلة المنتجات كاملة", async () => {
    await sql`
      update public.categories set sort_order = ${SECOND_CATEGORY_SORT + 10}
      where id = ${firstCategoryId}
    `;

    try {
      expect(await fixtureOrder()).toEqual([...SECOND_SKUS, ...FIRST_SKUS]);
    } finally {
      await sql`
        update public.categories set sort_order = ${FIRST_CATEGORY_SORT}
        where id = ${firstCategoryId}
      `;
    }
  });
});

describe("صفحة التصنيف — بلا تغيير", () => {
  test("منتجات التصنيف وحده بترتيب المدير", async () => {
    expect(await fixtureOrder("test-fixture-order-first")).toEqual(FIRST_SKUS);
  });

  test("ترتيب الثمن ما زال يتجاوز الترتيب اليدوي حين يطلبه الزبون", async () => {
    await sql`update public.products set sale_price = 5 where sku = ${FIRST_SKUS[2]}`;

    try {
      const products = await getProducts({
        categorySlug: "test-fixture-order-first",
        sort: "price_asc",
        limit: 500,
      });
      expect(products[0].sku).toBe(FIRST_SKUS[2]);
    } finally {
      await sql`update public.products set sale_price = 50 where sku = ${FIRST_SKUS[2]}`;
    }
  });
});
