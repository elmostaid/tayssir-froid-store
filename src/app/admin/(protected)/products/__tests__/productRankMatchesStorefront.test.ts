import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

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
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, redirect: vi.fn() };
});

const { moveProductToRank, moveProductUp, moveProductDown } = await import(
  "@/app/admin/(protected)/products/actions"
);

const ADMIN = { id: "rank-admin", email: "admin@local", role: "admin" as const };
const SKUS = ["RANK-A", "RANK-B", "RANK-C", "RANK-D", "RANK-E", "RANK-HIDDEN"];
const SLUG = "rank-test-category";

let categoryId: number;
const idBySku = new Map<string, number>();

/**
 * الاختبار الذي كان غيابه هو سبب بقاء العطل.
 *
 * كل ما سبقه كان يتحقّق من أن الرقم يُحفَظ، أو أن ORDER BY صحيح — وكلاهما
 * كان صحيحاً فعلاً. العطل كان في المسافة بينهما: الترقيم يعدّ كل صفوف
 * الجدول، وصفحة التصنيف تقرأ من عرضٍ يستبعد المسودّات. فمسودّة واحدة كانت
 * تُزيح كل ما بعدها بمركز.
 *
 * لذلك يقيس هذا الملف الشيء الوحيد الذي يهمّ: **الرقم المكتوب في لوحة
 * الإدارة مقابل الموضع الفعلي في `catalog_products`** — نفس المصدر الذي
 * تقرأ منه صفحة التصنيف — ومع مسودّة مدسوسة في وسط التصنيف عمداً.
 */
async function publicOrder(): Promise<string[]> {
  const rows = await sql<{ sku: string }[]>`
    select p.sku
    from public.catalog_products p
    where p.category_id = ${categoryId}
    order by p.sort_order asc, p.created_at desc, p.id desc
  `;
  return rows.map((r) => r.sku);
}

async function rankOf(sku: string): Promise<number> {
  const [row] = await sql<{ sort_order: number }[]>`
    select sort_order from public.products where sku = ${sku}
  `;
  return row.sort_order;
}

beforeAll(async () => {
  getAdminUserMock.mockResolvedValue(ADMIN);

  const [category] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, sort_order, is_active)
    values (${SLUG}, 'تصنيف اختبار الترتيب', 900, true)
    returning id
  `;
  categoryId = category.id;

  // خمسة معروضة ومسودّة واحدة بينها — المسودّة على المرتبة 3 عمداً، وهي
  // بالضبط الحالة التي كانت تكسر الترقيم في الإنتاج.
  const rows = await sql<{ id: number; sku: string }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price,
      stock_quantity, status, sort_order
    ) values
      ('RANK-A', 'rank-a', ${categoryId}, 'أ', 'قطعة', 1, 1, 10, 20, 5, 'published', 1),
      ('RANK-B', 'rank-b', ${categoryId}, 'ب', 'قطعة', 1, 1, 10, 20, 5, 'published', 2),
      ('RANK-HIDDEN', 'rank-hidden', ${categoryId}, 'مسودّة', 'قطعة', 1, 1, 10, 20, 5, 'draft', 3),
      ('RANK-C', 'rank-c', ${categoryId}, 'ج', 'قطعة', 1, 1, 10, 20, 5, 'published', 4),
      ('RANK-D', 'rank-d', ${categoryId}, 'د', 'قطعة', 1, 1, 10, 20, 5, 'published', 5),
      ('RANK-E', 'rank-e', ${categoryId}, 'هـ', 'قطعة', 1, 1, 10, 20, 5, 'published', 6)
    returning id, sku
  `;
  for (const row of rows) idBySku.set(row.sku, row.id);
});

afterAll(async () => {
  await sql`delete from public.products where sku = any(${SKUS})`;
  await sql`delete from public.categories where slug = ${SLUG}`;
});

describe("الرقم المكتوب يساوي الموضع على صفحة التصنيف", () => {
  test("سيناريو 5,1,4,2,3 → المتجر يعرض 1,2,3,4,5", async () => {
    // نعطي كل منتج مرتبته المطلوبة، بنفس ما يفعله المدير في اللوحة.
    // الترتيب المستهدَف النهائي: B, D, E, C, A
    await moveProductToRank(idBySku.get("RANK-A")!, 5);
    await moveProductToRank(idBySku.get("RANK-B")!, 1);
    await moveProductToRank(idBySku.get("RANK-C")!, 4);
    await moveProductToRank(idBySku.get("RANK-D")!, 2);
    await moveProductToRank(idBySku.get("RANK-E")!, 3);

    expect(await publicOrder()).toEqual(["RANK-B", "RANK-D", "RANK-E", "RANK-C", "RANK-A"]);

    // والأهم: رقم كل منتج = موضعه المعروض، لا موضعه بين كل الصفوف.
    expect(await rankOf("RANK-B")).toBe(1);
    expect(await rankOf("RANK-D")).toBe(2);
    expect(await rankOf("RANK-E")).toBe(3);
    expect(await rankOf("RANK-C")).toBe(4);
    expect(await rankOf("RANK-A")).toBe(5);
  });

  test("المسودّة لا تحجز مرتبة معروضة — تُركَن بعد الكل", async () => {
    const hiddenRank = await rankOf("RANK-HIDDEN");
    expect(hiddenRank).toBe(6);
    expect(await publicOrder()).not.toContain("RANK-HIDDEN");
  });

  test("تغيير مرتبة منتج واحد ينقله فعلاً — 1 → 4", async () => {
    await moveProductToRank(idBySku.get("RANK-B")!, 4);

    expect(await publicOrder()).toEqual(["RANK-D", "RANK-E", "RANK-C", "RANK-B", "RANK-A"]);
    expect(await rankOf("RANK-B")).toBe(4);
  });

  test("1 قبل 2 قبل 10 — ترتيب رقمي لا نصّي", async () => {
    const order = await publicOrder();
    const ranks = await Promise.all(order.map((sku) => rankOf(sku)));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // ولا تكرار ولا فجوات بين المعروضة.
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
  });

  test("«↑» تتخطّى المسودّة ولا تضيع الضغطة", async () => {
    // A آخر المعروضة (5). سهم الصعود يجب أن يجعلها رابعة، لا أن تُبدَّل مع
    // مسودّة فلا يتغيّر شيء على صفحة التصنيف.
    await moveProductUp(idBySku.get("RANK-A")!);
    expect(await rankOf("RANK-A")).toBe(4);
    expect(await publicOrder()).toEqual(["RANK-D", "RANK-E", "RANK-C", "RANK-A", "RANK-B"]);

    await moveProductDown(idBySku.get("RANK-A")!);
    expect(await rankOf("RANK-A")).toBe(5);
  });

  test("رقم أكبر من عدد المعروضة يُثبَّت عند الأخير", async () => {
    await moveProductToRank(idBySku.get("RANK-D")!, 999);
    expect(await rankOf("RANK-D")).toBe(5);
    expect((await publicOrder()).at(-1)).toBe("RANK-D");
  });

  test("منتج غير معروض يُرفَض برسالة واضحة بدل ترتيب بلا معنى", async () => {
    const result = await moveProductToRank(idBySku.get("RANK-HIDDEN")!, 1);
    expect(result.error).toContain("غير معروض");
    // ولم يتغيّر شيء.
    expect(await rankOf("RANK-HIDDEN")).toBe(6);
  });

  test("تصنيف آخر لا يتأثّر إطلاقاً", async () => {
    const before = await sql<{ id: number; sort_order: number }[]>`
      select id, sort_order from public.products
      where category_id <> ${categoryId} order by id limit 20
    `;
    await moveProductToRank(idBySku.get("RANK-E")!, 1);
    const after = await sql<{ id: number; sort_order: number }[]>`
      select id, sort_order from public.products
      where category_id <> ${categoryId} order by id limit 20
    `;
    expect(after).toEqual(before);
  });
});
