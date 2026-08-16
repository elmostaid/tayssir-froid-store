import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

// يغطي بقية Server Actions المقصورة على Owner/Admin (غير quickUpdateProduct،
// المُختبَرة فـproducts/__tests__/quickUpdateProduct.test.ts): إنشاء منتج،
// إنشاء تصنيف، تعديل الإعدادات، تعديل مصاريف التوصيل — Staff يُرفَض من كل
// واحد منها من جهة الخادم مباشرة، حتى لو استدعى الـServer Action مباشرة
// (متجاوزاً الواجهة). كما يؤكد أن إجراءات الطلبات (تغيير الحالة/الإلغاء)
// تبقى متاحة لـStaff (ضمن صلاحياته الصريحة).
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

const { createProduct } = await import("@/app/admin/(protected)/products/actions");
const { createCategory } = await import("@/app/admin/(protected)/categories/actions");
const { updateSettings } = await import("@/app/admin/(protected)/settings/actions");
const { updateDeliveryFee, updateOrderStatus } = await import(
  "@/app/admin/(protected)/orders/actions"
);

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

let categoryId: number;
let productFixturePhone: string;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  categoryId = category.id;
  productFixturePhone = "062222" + Math.floor(Math.random() * 10000).toString().padStart(4, "0");
});

afterAll(async () => {
  await sql`delete from public.products where sku like 'TEST-FIXTURE-STAFF-REJECT%'`;
  await sql`delete from public.categories where slug like 'test-fixture-staff-reject%'`;
  await sql`delete from public.orders where customer_phone = ${productFixturePhone}`;
});

describe("createProduct — Staff ممنوع تماماً", () => {
  test("Staff: يُرفَض ولا يُنشَأ أي منتج", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const fd = new FormData();
    fd.set("sku", "TEST-FIXTURE-STAFF-REJECT-1");
    fd.set("slug", "test-fixture-staff-reject-1");
    fd.set("categoryId", String(categoryId));
    fd.set("nameAr", "منتج يجب ألا يُنشأ");
    fd.set("unitLabel", "قطعة");
    fd.set("minOrderQty", "1");
    fd.set("qtyIncrement", "1");
    fd.set("purchasePrice", "50");
    fd.set("salePrice", "100");
    fd.set("stockQuantity", "10");
    fd.set("status", "draft");

    const result = await createProduct({ error: null }, fd);
    expect(result.error).toBeTruthy();

    const rows = await sql`select id from public.products where sku = 'TEST-FIXTURE-STAFF-REJECT-1'`;
    expect(rows).toHaveLength(0);
  });
});

describe("createCategory — Staff ممنوع تماماً", () => {
  test("Staff: يُرفَض ولا يُنشَأ أي تصنيف", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const fd = new FormData();
    fd.set("nameAr", "تصنيف يجب ألا يُنشأ");
    fd.set("slug", "test-fixture-staff-reject-category");
    fd.set("sortOrder", "0");

    const result = await createCategory({ error: null }, fd);
    expect(result.error).toBeTruthy();

    const rows = await sql`select id from public.categories where slug = 'test-fixture-staff-reject-category'`;
    expect(rows).toHaveLength(0);
  });
});

describe("updateSettings — Staff ممنوع تماماً", () => {
  test("Staff: يُرفَض ولا تتغيّر الإعدادات", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const [before] = await sql<{ value: unknown }[]>`
      select value from public.settings where key = 'store_name'
    `;

    const fd = new FormData();
    fd.set("minOrderAmountMad", "1000");
    fd.set("deliveryFeePerCartonMad", "45");
    fd.set("whatsappNumber", "+212722083458");
    fd.set("storeCity", "مراكش");
    fd.set("storeName", "اسم يجب ألا يُحفَظ");
    fd.set("whatsappOrderMessageTemplate", "test");
    fd.set("codEnabled", "on");

    const result = await updateSettings({ error: null }, fd);
    expect(result.error).toBeTruthy();

    const [after] = await sql<{ value: unknown }[]>`
      select value from public.settings where key = 'store_name'
    `;
    expect(after.value).toEqual(before.value);
  });
});

describe("updateDeliveryFee — Staff ممنوع (حقل مالي)، updateOrderStatus متاح لـStaff", () => {
  // طلب اختبار مُخصَّص عبر إدخال مباشر (وليس createOrder ولا أي طلب حقيقي
  // موجود مسبقاً فالقاعدة) — هذان الاختباران يعدّلان حالة/مصاريف الطلب،
  // فيجب أن يعملا على بيانات اختبار معزولة تماماً بدل لمس أي طلب حقيقي.
  let orderId: number;

  beforeAll(async () => {
    const [order] = await sql<{ id: number }[]>`
      insert into public.orders (
        customer_name, customer_phone, customer_city, customer_address,
        items_subtotal, status, source
      ) values (
        'زبون اختبار صلاحيات', ${productFixturePhone}, 'الرباط', 'عنوان اختبار',
        500.00, 'new', 'website'
      )
      returning id
    `;
    orderId = order.id;
  });

  test("Staff: يُرفَض تعديل مصاريف التوصيل", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const fd = new FormData();
    fd.set("orderId", String(orderId));
    fd.set("deliveryFee", "999");

    const result = await updateDeliveryFee({ error: null }, fd);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("Admin");

    const [row] = await sql<{ delivery_fee: string | null }[]>`
      select delivery_fee from public.orders where id = ${orderId}
    `;
    expect(row.delivery_fee).toBeNull();
  });

  test("Admin: يقدر يعدّل مصاريف التوصيل بنجاح", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const fd = new FormData();
    fd.set("orderId", String(orderId));
    fd.set("deliveryFee", "45");

    const result = await updateDeliveryFee({ error: null }, fd);
    expect(result.error).toBeNull();

    const [row] = await sql<{ delivery_fee: string | null }[]>`
      select delivery_fee from public.orders where id = ${orderId}
    `;
    expect(Number(row.delivery_fee)).toBe(45);
  });

  test("Staff: يقدر يغيّر حالة الطلب (لا رفض صلاحيات)", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const fd = new FormData();
    fd.set("orderId", String(orderId));
    fd.set("status", "confirmed");
    fd.set("note", "");

    const result = await updateOrderStatus({ error: null }, fd);
    expect(result.error).toBeNull();

    const [row] = await sql<{ status: string }[]>`select status from public.orders where id = ${orderId}`;
    expect(row.status).toBe("confirmed");
  });
});
