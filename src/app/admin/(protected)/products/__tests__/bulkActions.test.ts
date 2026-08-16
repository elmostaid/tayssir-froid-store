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

const { createBulkProduct } = await import(
  "@/app/admin/(protected)/products/bulkActions"
);

const ADMIN_USER = { id: "test-admin-bulk", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff-bulk", email: "staff@local", role: "staff" as const };

let emptyCategoryId: number;
let prefixedCategoryId: number;
let raceCategoryId: number;

function baseInput(overrides: Partial<Parameters<typeof createBulkProduct>[0]> = {}) {
  return {
    categoryId: emptyCategoryId,
    nameAr: "منتج اختبار الدفعة",
    purchasePrice: 50,
    salePrice: 90,
    minOrderQty: 1,
    qtyIncrement: 1,
    stockQuantity: 500,
    status: "published" as const,
    descriptionAr: "",
    ...overrides,
  };
}

beforeAll(async () => {
  const [c1] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-bulkadd-empty', 'تصنيف اختبار الإضافة الجماعية 1', true)
    returning id
  `;
  emptyCategoryId = c1.id;

  const [c2] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-bulkadd-prefixed', 'تصنيف اختبار الإضافة الجماعية 2', true)
    returning id
  `;
  prefixedCategoryId = c2.id;
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status
    ) values (
      'TBX-BA-007', 'test-fixture-bulkadd-existing', ${prefixedCategoryId}, 'منتج موجود سلفاً', 'قطعة', 1, 1, 10.00, 5, 'published'
    )
  `;

  const [c3] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-bulkadd-race', 'تصنيف اختبار الإضافة الجماعية 3 (تزامن)', true)
    returning id
  `;
  raceCategoryId = c3.id;
});

afterAll(async () => {
  await sql`delete from public.products where sku like 'TBX-%' or sku like 'TF-TFB%'`;
  await sql`delete from public.categories where slug like 'test-fixture-bulkadd-%'`;
});

describe("createBulkProduct — صلاحيات", () => {
  test("Staff: يُرفَض", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const result = await createBulkProduct(baseInput());
    expect(result.outcome).toBe("error");
  });
});

describe("createBulkProduct — تحقق من صحة المدخلات", () => {
  test("اسم فارغ: خطأ واضح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await createBulkProduct(baseInput({ nameAr: "   " }));
    expect(result.outcome).toBe("error");
  });

  test("تصنيف غير صحيح: خطأ واضح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await createBulkProduct(baseInput({ categoryId: -1 }));
    expect(result.outcome).toBe("error");
  });

  test("ثمن بيع سالب: خطأ واضح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await createBulkProduct(baseInput({ salePrice: -5 }));
    expect(result.outcome).toBe("error");
  });

  test("أقل عدد أصغر من 1: خطأ واضح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await createBulkProduct(baseInput({ minOrderQty: 0 }));
    expect(result.outcome).toBe("error");
  });
});

describe("createBulkProduct — تصنيف بلا أي منتج بعد", () => {
  test("يُنشئ المنتج بنجاح، SKU مشتق من slug التصنيف برقم 001، slug = sku بحروف صغيرة", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await createBulkProduct(
      baseInput({ nameAr: "منتج اختبار فارغ 1", descriptionAr: "وصف مشترك للدفعة" })
    );
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    expect(result.sku).toMatch(/^TF-TFB-001$/);
    expect(result.slug).toBe(result.sku.toLowerCase());

    const rows = await sql<
      { description_ar: string; purchase_price: string; status: string }[]
    >`select description_ar, purchase_price, status from public.products where id = ${result.productId}`;
    expect(rows[0].description_ar).toContain("وصف مشترك للدفعة");
    expect(rows[0].description_ar).toContain(
      "المرجو مقارنة شكل القطعة، الفيشة، عدد الأطراف ومواضع التثبيت مع القطعة الأصلية قبل الطلب."
    );
    expect(rows[0].purchase_price).toBe("50.00");
    expect(rows[0].status).toBe("published");
  });

  test("المنتج الثاني فنفس التصنيف يتابع الرقم التالي (002) لأن الأول التزم فعلياً فالقاعدة", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await createBulkProduct(baseInput({ nameAr: "منتج اختبار فارغ 2" }));
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    expect(result.sku).toBe("TF-TFB-002");
  });
});

describe("createBulkProduct — تصنيف بمنتج موجود يُكمِل نفس البادئة", () => {
  test("يُولِّد TBX-BA-008 (بعد أكبر رقم مُستعمَل فعلياً)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await createBulkProduct(
      baseInput({ categoryId: prefixedCategoryId, nameAr: "منتج اختبار بادئة موجودة" })
    );
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    expect(result.sku).toBe("TBX-BA-008");
  });
});

describe("createBulkProduct — منع التكرار", () => {
  test("نفس الاسم فنفس التصنيف مرة ثانية = مكرر، بلا إنشاء صفّ جديد", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const countBefore = await sql<{ count: number }[]>`
      select count(*)::int as count from public.products where category_id = ${prefixedCategoryId}
    `;

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await createBulkProduct(
      baseInput({ categoryId: prefixedCategoryId, nameAr: "منتج موجود سلفاً" })
    );
    expect(result.outcome).toBe("duplicate");

    const countAfter = await sql<{ count: number }[]>`
      select count(*)::int as count from public.products where category_id = ${prefixedCategoryId}
    `;
    expect(countAfter[0].count).toBe(countBefore[0].count);
  });
});

describe("createBulkProduct — أمان تحت التزامن الحقيقي", () => {
  test("طلبان متزامنان لنفس التصنيف الفارغ ينتجان SKU مختلفَين، بلا أي تعارض", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const [resultA, resultB] = await Promise.all([
      createBulkProduct({
        categoryId: raceCategoryId,
        nameAr: "منتج تزامن أ",
        purchasePrice: 10,
        salePrice: 20,
        minOrderQty: 1,
        qtyIncrement: 1,
        stockQuantity: 500,
        status: "published",
        descriptionAr: "",
      }),
      createBulkProduct({
        categoryId: raceCategoryId,
        nameAr: "منتج تزامن ب",
        purchasePrice: 10,
        salePrice: 20,
        minOrderQty: 1,
        qtyIncrement: 1,
        stockQuantity: 500,
        status: "published",
        descriptionAr: "",
      }),
    ]);

    expect(resultA.outcome).toBe("success");
    expect(resultB.outcome).toBe("success");
    if (resultA.outcome === "success" && resultB.outcome === "success") {
      expect(resultA.sku).not.toBe(resultB.sku);
    }
  });
});
