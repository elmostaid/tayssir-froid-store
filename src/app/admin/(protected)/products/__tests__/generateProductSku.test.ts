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
  // تمرير مباشر: لا تخزين مؤقّت في الاختبارات، فينفَّذ الاستعلام الحقيقي.
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, redirect: vi.fn() };
});

const { generateProductSku } = await import("@/app/admin/(protected)/products/actions");
const { isSkuTakenByOtherProduct } = await import("@/lib/queries/adminProducts");

const ADMIN_USER = { id: "test-admin-sku-gen", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff-sku-gen", email: "staff@local", role: "staff" as const };

let categoryWithPrefixId: number;
let emptyCategoryId: number;
let otherCategorySamePrefixId: number;

async function insertProduct(sku: string, slug: string, categoryId: number) {
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status
    ) values (
      ${sku}, ${slug}, ${categoryId}, ${"منتج اختبار " + sku}, 'قطعة', 1, 1, 10.00, 5, 'published'
    )
  `;
}

beforeAll(async () => {
  const [c1] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-skugen-with-prefix', 'تصنيف اختبار توليد SKU 1', true)
    returning id
  `;
  categoryWithPrefixId = c1.id;

  const [c2] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-skugen-empty', 'تصنيف اختبار توليد SKU 2', true)
    returning id
  `;
  emptyCategoryId = c2.id;

  const [c3] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-skugen-shared-prefix', 'تصنيف اختبار توليد SKU 3', true)
    returning id
  `;
  otherCategorySamePrefixId = c3.id;

  await insertProduct("TFX-GA-001", "test-fixture-skugen-a1", categoryWithPrefixId);
  await insertProduct("TFX-GA-002", "test-fixture-skugen-a2", categoryWithPrefixId);
  await insertProduct("TFX-GA-005", "test-fixture-skugen-a5", categoryWithPrefixId);

  // نفس البادئة TFX-GA لكن فتصنيف مختلف تماماً، برقم أكبر — SKU فريد على
  // مستوى الجدول كله، فلازم توليد التصنيف الأول يتفادى هذا الرقم أيضاً.
  await insertProduct("TFX-GA-050", "test-fixture-skugen-shared", otherCategorySamePrefixId);
});

afterAll(async () => {
  await sql`delete from public.products where sku like 'TFX-GA-%' or sku like 'TF-TFS-%'`;
  await sql`delete from public.categories where slug like 'test-fixture-skugen-%'`;
});

describe("generateProductSku — Staff ممنوع", () => {
  test("Staff: يُرفَض", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const result = await generateProductSku(categoryWithPrefixId);
    expect("error" in result).toBe(true);
  });
});

describe("generateProductSku — تصنيف صحيح", () => {
  test("رقم تصنيف غير صحيح: خطأ واضح بلا استعلام", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await generateProductSku(-1);
    expect("error" in result).toBe(true);
  });

  test("تصنيف غير موجود: خطأ واضح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await generateProductSku(999999999);
    expect("error" in result).toBe(true);
  });
});

describe("generateProductSku — تصنيف بمنتجات موجودة يُكمِل نفس البادئة بأول رقم فارغ حقاً", () => {
  test("يُولِّد TFX-GA-051 (بعد أكبر رقم مُستعمَل فعلياً بهذه البادئة عبر كل التصنيفات، وليس فقط 005 المحلي)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await generateProductSku(categoryWithPrefixId);
    expect("sku" in result).toBe(true);
    if ("sku" in result) {
      expect(result.sku).toBe("TFX-GA-051");
    }
  });

  test("النتيجة فريدة فعلاً (isSkuTakenByOtherProduct ترجع false)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await generateProductSku(categoryWithPrefixId);
    expect("sku" in result).toBe(true);
    if ("sku" in result) {
      expect(await isSkuTakenByOtherProduct(result.sku)).toBe(false);
    }
  });
});

describe("generateProductSku — تصنيف بلا أي منتج بعد", () => {
  test("يُشتَق بادئة من slug التصنيف نفسه (test-fixture-skugen-empty → أول حرف من كل كلمة: TF-TFS)، برقم 001", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await generateProductSku(emptyCategoryId);
    expect("sku" in result).toBe(true);
    if ("sku" in result) {
      expect(result.sku).toBe("TF-TFS-001");
      expect(await isSkuTakenByOtherProduct(result.sku)).toBe(false);
    }
  });
});

describe("generateProductSku — لا يغيّر أي بيانات موجودة", () => {
  test("لا يُدرج أي صف فقاعدة البيانات (مجرد اقتراح، بلا حفظ)", async () => {
    const before = await sql`select count(*)::int as count from public.products`;
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await generateProductSku(categoryWithPrefixId);
    const after = await sql`select count(*)::int as count from public.products`;
    expect(after[0].count).toBe(before[0].count);
  });
});
