import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

const updateTagMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (...args: unknown[]) => updateTagMock(...args),
  revalidateTag: vi.fn(),
  // تمرير مباشر: لا تخزين مؤقّت في الاختبارات، فينفَّذ الاستعلام الحقيقي.
  unstable_cache: (fn: unknown) => fn,
}));

const { updateProduct } = await import("@/app/admin/(protected)/products/actions");
const { CATALOG_TAG } = await import("@/lib/queries/catalogCache");

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };

/**
 * نقل منتج بين تصنيفين من نموذج التعديل الكامل.
 *
 * ما كان يقع: المنتج يحمل معه رقم مرتبته من تصنيفه القديم. sort_order رقمٌ
 * **داخل التصنيف** (1..N لكل تصنيف على حدة)، فمنتج كان المرتبة 1 ينزل فوق
 * منتج يحمل الرقم 1 أصلاً فالتصنيف الجديد — رقمان متساويان لا يفصل بينهما
 * إلا created_at، أي ترتيب لم يطلبه المدير ولا يستطيع تفسيره.
 */
let sourceCategoryId: number;
let targetCategoryId: number;
let movedProductId: number;

async function sortOrderOf(sku: string): Promise<number> {
  const [row] = await sql<{ sort_order: number }[]>`
    select sort_order from public.products where sku = ${sku}
  `;
  return row.sort_order;
}

function buildForm(categoryId: number): FormData {
  const fd = new FormData();
  fd.set("sku", "TEST-FIXTURE-MOVECAT-MOVED");
  fd.set("slug", "test-fixture-movecat-moved");
  fd.set("categoryId", String(categoryId));
  fd.set("nameAr", "منتج ينتقل بين تصنيفين");
  fd.set("unitLabel", "قطعة");
  fd.set("minOrderQty", "1");
  fd.set("qtyIncrement", "1");
  fd.set("purchasePrice", "50");
  fd.set("salePrice", "100");
  fd.set("stockQuantity", "10");
  fd.set("status", "published");
  return fd;
}

beforeAll(async () => {
  await sql`delete from public.products where sku like 'TEST-FIXTURE-MOVECAT-%'`;

  const [source] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active, sort_order)
    values ('test-fixture-movecat-source', 'تصنيف المصدر', true, 9101)
    on conflict (slug) do update set is_active = true, sort_order = 9101
    returning id
  `;
  sourceCategoryId = source.id;

  const [target] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active, sort_order)
    values ('test-fixture-movecat-target', 'تصنيف الهدف', true, 9102)
    on conflict (slug) do update set is_active = true, sort_order = 9102
    returning id
  `;
  targetCategoryId = target.id;

  // التصنيف الهدف فيه ثلاثة منتجات مُرقَّمة 1، 2، 3.
  for (let i = 1; i <= 3; i++) {
    await sql`
      insert into public.products (
        sku, slug, category_id, name_ar, unit_label,
        min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order
      ) values (
        ${`TEST-FIXTURE-MOVECAT-T${i}`}, ${`test-fixture-movecat-t${i}`},
        ${targetCategoryId}, ${`منتج هدف ${i}`}, 'قطعة', 1, 1, 60, 5, 'published', ${i}
      )
    `;
  }

  // والمنتج المنقول هو المرتبة 1 فتصنيفه القديم — أسوأ حالة للتصادم.
  const [moved] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status, sort_order
    ) values (
      'TEST-FIXTURE-MOVECAT-MOVED', 'test-fixture-movecat-moved', ${sourceCategoryId},
      'منتج ينتقل بين تصنيفين', 'قطعة', 1, 1, 50, 100, 10, 'published', 1
    )
    returning id
  `;
  movedProductId = moved.id;
});

beforeEach(async () => {
  await sql`
    update public.products set category_id = ${sourceCategoryId}, sort_order = 1
    where id = ${movedProductId}
  `;
  getAdminUserMock.mockReset();
  updateTagMock.mockClear();
});

afterAll(async () => {
  await sql`delete from public.products where sku like 'TEST-FIXTURE-MOVECAT-%'`;
  await sql`delete from public.categories where slug like 'test-fixture-movecat-%'`;
});

describe("updateProduct — تغيير التصنيف يُعيد ترتيب المنتج", () => {
  test("المنتج المنقول يقع آخر التصنيف الجديد، لا فوق منتج يحمل رقمه", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await updateProduct(movedProductId, { error: null }, buildForm(targetCategoryId));

    expect(result.error).toBeNull();
    expect(await sortOrderOf("TEST-FIXTURE-MOVECAT-MOVED")).toBe(4);
  });

  test("منتجات التصنيف الجديد لا تتزحزح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await updateProduct(movedProductId, { error: null }, buildForm(targetCategoryId));

    expect(await sortOrderOf("TEST-FIXTURE-MOVECAT-T1")).toBe(1);
    expect(await sortOrderOf("TEST-FIXTURE-MOVECAT-T2")).toBe(2);
    expect(await sortOrderOf("TEST-FIXTURE-MOVECAT-T3")).toBe(3);
  });

  test("حفظ بلا تغيير تصنيف يُبقي المرتبة كما هي", async () => {
    await sql`update public.products set sort_order = 7 where id = ${movedProductId}`;

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await updateProduct(movedProductId, { error: null }, buildForm(sourceCategoryId));

    expect(await sortOrderOf("TEST-FIXTURE-MOVECAT-MOVED")).toBe(7);
  });

  test("كل حفظ ناجح يُبطل وسم الكتالوج فيرى الزبون التغيير فوراً", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await updateProduct(movedProductId, { error: null }, buildForm(sourceCategoryId));

    expect(updateTagMock).toHaveBeenCalledWith(CATALOG_TAG);
  });
});
