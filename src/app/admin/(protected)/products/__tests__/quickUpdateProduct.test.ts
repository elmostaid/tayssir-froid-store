import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

// نفس نمط orders/__tests__/actions.test.ts: getAdminUser() تحتاج جلسة
// Supabase Auth حقيقية غير متاحة فبيئة الاختبار — نُحاكيها هنا (vi.fn قابل
// لتغيير قيمته لكل اختبار عبر mockResolvedValueOnce)، مع الإبقاء على فحص
// الحماية الحقيقي نفسه فـpageGuards.test.ts وroleGuards.test.ts منفصلاً.
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

const { quickUpdateProduct } = await import("@/app/admin/(protected)/products/actions");
const { CATALOG_TAG } = await import("@/lib/queries/catalogCache");

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

let productId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-QUICKEDIT', 'test-fixture-quickedit', ${category.id},
      'منتج اختبار التعديل السريع', 'قطعة', 1, 1, 100.00, 250.00, 50, 'draft'
    )
    on conflict (sku) do update set
      purchase_price = 100.00, sale_price = 250.00, stock_quantity = 50,
      min_order_qty = 1, status = 'draft'
    returning id
  `;
  productId = product.id;
});

afterEach(async () => {
  await sql`delete from public.stock_movements where product_id = ${productId} and reason = 'manual_adjustment'`;
  await sql`
    update public.products set
      purchase_price = 100.00, sale_price = 250.00, stock_quantity = 50,
      min_order_qty = 1, status = 'draft'
    where id = ${productId}
  `;
});

afterAll(async () => {
  await sql`delete from public.stock_movements where product_id = ${productId}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-QUICKEDIT'`;
});

function quickEditForm(fields: {
  salePrice: string;
  purchasePrice: string;
  stockQuantity: string;
  minOrderQty: string;
  status: string;
}): FormData {
  const fd = new FormData();
  fd.set("salePrice", fields.salePrice);
  fd.set("purchasePrice", fields.purchasePrice);
  fd.set("stockQuantity", fields.stockQuantity);
  fd.set("minOrderQty", fields.minOrderQty);
  fd.set("status", fields.status);
  return fd;
}

describe("quickUpdateProduct — Owner/Admin يقدر يعدّل، Staff يُمنَع تماماً", () => {
  test("Staff: يُرفَض الإجراء ولا يتغيّر أي شيء فقاعدة البيانات (بما فيها purchase_price)", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const result = await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "999",
        purchasePrice: "999",
        stockQuantity: "999",
        minOrderQty: "5",
        status: "published",
      })
    );

    expect(result.error).toBeTruthy();
    expect(result.success).toBeFalsy();

    const [row] = await sql<{ sale_price: string; purchase_price: string; stock_quantity: number }[]>`
      select sale_price, purchase_price, stock_quantity from public.products where id = ${productId}
    `;
    expect(Number(row.sale_price)).toBe(250);
    expect(Number(row.purchase_price)).toBe(100);
    expect(row.stock_quantity).toBe(50);
  });

  test("Admin: يعدّل ثمن البيع بنجاح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "300.50",
        purchasePrice: "100",
        stockQuantity: "50",
        minOrderQty: "1",
        status: "draft",
      })
    );

    expect(result.success).toBe(true);
    const [row] = await sql<{ sale_price: string }[]>`
      select sale_price from public.products where id = ${productId}
    `;
    expect(Number(row.sale_price)).toBe(300.5);
  });

  test("Admin: يعدّل ثمن الشراء بنجاح (Admin-only، لا يظهر لغير هذا المسار)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "250",
        purchasePrice: "120.75",
        stockQuantity: "50",
        minOrderQty: "1",
        status: "draft",
      })
    );

    expect(result.success).toBe(true);
    const [row] = await sql<{ purchase_price: string }[]>`
      select purchase_price from public.products where id = ${productId}
    `;
    expect(Number(row.purchase_price)).toBe(120.75);
  });

  test("Admin: يعدّل المخزون ويسجّل حركة manual_adjustment بالفرق الصحيح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "250",
        purchasePrice: "100",
        stockQuantity: "80", // من 50 إلى 80 => delta = +30
        minOrderQty: "1",
        status: "draft",
      })
    );

    expect(result.success).toBe(true);

    const [row] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${productId}
    `;
    expect(row.stock_quantity).toBe(80);

    const movements = await sql<{ quantity_delta: number; reason: string; order_id: number | null }[]>`
      select quantity_delta, reason, order_id from public.stock_movements
      where product_id = ${productId} and reason = 'manual_adjustment'
      order by created_at desc limit 1
    `;
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity_delta).toBe(30);
    expect(movements[0].reason).toBe("manual_adjustment");
    expect(movements[0].order_id).toBeNull();
  });

  test("Admin: لا يسجّل أي حركة مخزون إذا لم تتغيّر الكمية", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "250",
        purchasePrice: "100",
        stockQuantity: "50", // بلا تغيير
        minOrderQty: "1",
        status: "draft",
      })
    );

    const movements = await sql<{ id: number }[]>`
      select id from public.stock_movements
      where product_id = ${productId} and reason = 'manual_adjustment'
    `;
    expect(movements).toHaveLength(0);
  });

  test("Admin: يعدّل أقل كمية للطلب بنجاح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "250",
        purchasePrice: "100",
        stockQuantity: "50",
        minOrderQty: "7",
        status: "draft",
      })
    );

    expect(result.success).toBe(true);
    const [row] = await sql<{ min_order_qty: number }[]>`
      select min_order_qty from public.products where id = ${productId}
    `;
    expect(row.min_order_qty).toBe(7);
  });

  test("Admin: ينشر المنتج (draft → published)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "250",
        purchasePrice: "100",
        stockQuantity: "50",
        minOrderQty: "1",
        status: "published",
      })
    );

    expect(result.success).toBe(true);
    const [row] = await sql<{ status: string }[]>`select status from public.products where id = ${productId}`;
    expect(row.status).toBe("published");
  });

  test("Admin: يرفض قيمة سالبة (validation)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "-10",
        purchasePrice: "100",
        stockQuantity: "50",
        minOrderQty: "1",
        status: "draft",
      })
    );

    expect(result.error).toBeTruthy();
    expect(result.fieldErrors?.salePrice).toBeTruthy();

    const [row] = await sql<{ sale_price: string }[]>`select sale_price from public.products where id = ${productId}`;
    expect(Number(row.sale_price)).toBe(250); // لم يتغيّر
  });

  test("Admin: يرفض مخزوناً سالباً (validation)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const result = await quickUpdateProduct(
      productId,
      { error: null },
      quickEditForm({
        salePrice: "250",
        purchasePrice: "100",
        stockQuantity: "-5",
        minOrderQty: "1",
        status: "draft",
      })
    );

    expect(result.error).toBeTruthy();
    expect(result.fieldErrors?.stockQuantity).toBeTruthy();
  });
});

describe("التعديل السريع يُبطل ذاكرة الكتالوج", () => {
  // العطل الذي أوجب هذا الاختبار: quickUpdateProduct كانت تستدعي
  // revalidatePath لصفحات /admin فقط، بلا إبطال وسم الكتالوج الذي يقرأ منه
  // الزبون (unstable_cache بمهلة 60 ثانية). فالمدير يغيّر ثمناً أو ينشر
  // منتجاً ويفتح المتجر فلا يرى شيئاً تغيّر — ويظن أن الحفظ فشل، فيعيده.
  test("Admin: كل حفظ ناجح يُبطل وسم الكتالوج", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    updateTagMock.mockClear();

    const fd = new FormData();
    fd.set("salePrice", "277");
    fd.set("purchasePrice", "100");
    fd.set("stockQuantity", "50");
    fd.set("minOrderQty", "1");
    fd.set("status", "draft");

    const result = await quickUpdateProduct(productId, { error: null }, fd);

    expect(result.error).toBeNull();
    expect(updateTagMock).toHaveBeenCalledWith(CATALOG_TAG);
  });

  test("Staff: الرفض لا يُبطل شيئاً (لا كتابة أصلاً)", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    updateTagMock.mockClear();

    const fd = new FormData();
    fd.set("salePrice", "999");
    fd.set("purchasePrice", "100");
    fd.set("stockQuantity", "50");
    fd.set("minOrderQty", "1");
    fd.set("status", "draft");

    await quickUpdateProduct(productId, { error: null }, fd);

    expect(updateTagMock).not.toHaveBeenCalled();
  });
});
