import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { toggleCategoryVisibility } = await import(
  "@/app/admin/(protected)/categories/actions"
);
const { getCategories } = await import("@/lib/queries/catalog");

const ADMIN_USER = { id: "test-admin-togglecat", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff-togglecat", email: "staff@local", role: "staff" as const };

let categoryId: number;
let categorySlug: string;

beforeAll(async () => {
  categorySlug = "test-fixture-togglecat";
  const [category] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values (${categorySlug}, 'تصنيف اختبار النشر/الإخفاء', false)
    returning id
  `;
  categoryId = category.id;
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status
    ) values (
      'TGX-CAT-001', 'test-fixture-togglecat-product', ${categoryId}, 'منتج اختبار النشر', 'قطعة', 1, 1, 10.00, 5, 'published'
    )
  `;
});

afterAll(async () => {
  await sql`delete from public.products where sku = 'TGX-CAT-001'`;
  await sql`delete from public.categories where slug = ${categorySlug}`;
});

describe("toggleCategoryVisibility — صلاحيات", () => {
  test("Staff: يُرفَض، ولا يتغيّر شيء", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const result = await toggleCategoryVisibility(categoryId, true);
    expect(result.error).not.toBeNull();

    const row = await sql<{ is_active: boolean }[]>`
      select is_active from public.categories where id = ${categoryId}
    `;
    expect(row[0].is_active).toBe(false);
  });
});

describe("toggleCategoryVisibility — تصنيف غير موجود", () => {
  test("خطأ واضح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await toggleCategoryVisibility(999999999, true);
    expect(result.error).not.toBeNull();
  });
});

describe("toggleCategoryVisibility — نشر تصنيف مخفي به منتج منشور", () => {
  test("is_active يصبح true فعلياً فقاعدة البيانات", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await toggleCategoryVisibility(categoryId, true);
    expect(result.error).toBeNull();

    const row = await sql<{ is_active: boolean }[]>`
      select is_active from public.categories where id = ${categoryId}
    `;
    expect(row[0].is_active).toBe(true);
  });

  test("التصنيف أصبح ظاهراً فعلياً فgetCategories (المصدر الوحيد للواجهة العامة)", async () => {
    const categories = await getCategories();
    expect(categories.some((c) => c.id === categoryId)).toBe(true);
  });

  test("revalidatePath استُدعي للصفحات المتأثرة (الرئيسية، صفحة التصنيف، sitemap)", () => {
    const paths = revalidatePathMock.mock.calls.map((call) => call[0]);
    expect(paths).toContain("/");
    expect(paths).toContain(`/category/${categorySlug}`);
    expect(paths).toContain("/sitemap.xml");
  });
});

describe("toggleCategoryVisibility — إخفاء تصنيف يختفي فوراً من الواجهة العامة، بلا مسّ للمنتج", () => {
  test("is_active يصبح false، والتصنيف يختفي من getCategories رغم بقاء منتجه المنشور", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await toggleCategoryVisibility(categoryId, false);
    expect(result.error).toBeNull();

    const categories = await getCategories();
    expect(categories.some((c) => c.id === categoryId)).toBe(false);

    const product = await sql<{ status: string }[]>`
      select status from public.products where sku = 'TGX-CAT-001'
    `;
    expect(product[0].status).toBe("published");
  });
});
