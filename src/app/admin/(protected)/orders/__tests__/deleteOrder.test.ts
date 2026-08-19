import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";

// اختبار تكامل حقيقي على قاعدة بيانات حية — الهدف منه بالذات التحقّق من أن
// الحذف يعتمد فعلاً على المفاتيح الأجنبية الموجودة في المخطَّط (CASCADE على
// order_items وorder_status_history، وSET NULL على stock_movements). محاكاة
// القاعدة هنا كانت ستُخفي بالضبط ما نريد إثباته.
//
// getAdminUser تحتاج جلسة Supabase Auth حقيقية غير متاحة في الاختبارات،
// فنُحاكيها بمدير بدور "admin". isOwnerAdmin يبقى المنطق الحقيقي (نستورده
// من الوحدة الأصلية) حتى لا نُضعِف فحص الصلاحية الذي نختبره.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: () => getAdminUserMock() };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { deleteOrder } = await import("@/app/admin/(protected)/orders/actions");

const OWNER = { id: "test-owner", email: "owner@local", role: "admin" as const };
const STAFF = { id: "test-staff", email: "staff@local", role: "staff" as const };

const TEST_PHONE_PREFIX = "069999";
let phoneCounter = 0;
let fixtureProductId: number;

async function makeOrder(): Promise<{ id: number; orderNumber: string }> {
  phoneCounter += 1;
  const result = await createOrder({
    items: [{ productId: fixtureProductId, variantId: null, quantity: 4 }],
    customer: {
      fullName: "زبون اختبار الحذف",
      phone: `${TEST_PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`,
      city: "مراكش",
      address: "عنوان اختبار",
      notes: null,
    },
    idempotencyKey: randomUUID(),
    requestContext: null,
  });
  if (!result.ok) throw new Error("fixture order failed: " + JSON.stringify(result.errors));
  const [row] = await sql<{ id: number; order_number: string }[]>`
    select id, order_number from public.orders where public_reference = ${result.publicReference}
  `;
  return { id: row.id, orderNumber: row.order_number };
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-DELETE-ORDER', 'test-fixture-delete-order', ${category.id},
      'منتج اختبار حذف الطلبات', 'قطعة', 1, 1, 100.00, 300.00, 500, 'published'
    )
    on conflict (sku) do update set stock_quantity = 500
    returning id
  `;
  fixtureProductId = product.id;
});

afterAll(async () => {
  await sql`delete from public.stock_movements where product_id = ${fixtureProductId}`;
  await sql`delete from public.orders where customer_phone like ${TEST_PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-DELETE-ORDER'`;
});

describe("deleteOrder — الصلاحيات", () => {
  test("زائر غير مسجَّل: يُرفَض ولا يُحذف شيء", async () => {
    getAdminUserMock.mockResolvedValueOnce(null);
    const order = await makeOrder();
    const result = await deleteOrder(order.id);
    expect(result.error).toBeTruthy();
    const [still] = await sql`select id from public.orders where id = ${order.id}`;
    expect(still).toBeTruthy();
  });

  test("Staff: يُرفَض ولا يُحذف شيء — الحذف مقصور على Admin", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF);
    const order = await makeOrder();
    const result = await deleteOrder(order.id);
    expect(result.error).toMatch(/مقصور على صاحب الحساب/);
    const [still] = await sql`select id from public.orders where id = ${order.id}`;
    expect(still).toBeTruthy();
  });
});

describe("deleteOrder — الحذف الفعلي والعلاقات", () => {
  test("يحذف الطلب وسطوره وسجل حالاته، ويُعيد رقم الطلب", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const order = await makeOrder();

    const itemsBefore = await sql`select id from public.order_items where order_id = ${order.id}`;
    const historyBefore = await sql`select id from public.order_status_history where order_id = ${order.id}`;
    expect(itemsBefore.length).toBeGreaterThan(0);
    expect(historyBefore.length).toBeGreaterThan(0);

    const result = await deleteOrder(order.id);
    expect(result.error).toBeNull();
    if (result.error !== null) return;
    expect(result.orderNumber).toBe(order.orderNumber);

    // CASCADE في المخطَّط يتكفّل بالجدولين المرتبطين.
    expect((await sql`select id from public.orders where id = ${order.id}`).length).toBe(0);
    expect((await sql`select id from public.order_items where order_id = ${order.id}`).length).toBe(0);
    expect(
      (await sql`select id from public.order_status_history where order_id = ${order.id}`).length
    ).toBe(0);
  });

  test("حركات المخزون تبقى محفوظة مع order_id = NULL (سجل جرد لا يُفقَد)", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const order = await makeOrder();

    const movesBefore = await sql<{ id: number }[]>`
      select id from public.stock_movements where order_id = ${order.id}
    `;
    expect(movesBefore.length).toBeGreaterThan(0);

    expect((await deleteOrder(order.id)).error).toBeNull();

    const stillThere = await sql<{ order_id: number | null }[]>`
      select order_id from public.stock_movements where id in ${sql(movesBefore.map((m) => m.id))}
    `;
    expect(stillThere.length).toBe(movesBefore.length);
    for (const row of stillThere) expect(row.order_id).toBeNull();
  });

  test("الحذف لا يُرجِع الكمية إلى المخزون (الإرجاع يقع عند الإلغاء فقط)", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const order = await makeOrder();
    const [before] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;

    expect((await deleteOrder(order.id)).error).toBeNull();

    const [after] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;
    expect(after.stock_quantity).toBe(before.stock_quantity);
  });

  test("طلب غير موجود: رسالة واضحة بلا أي حذف", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const result = await deleteOrder(999_999_999);
    expect(result.error).toMatch(/غير موجود/);
  });

  test("رقم طلب غير صالح: يُرفَض قبل لمس القاعدة", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    expect((await deleteOrder(0)).error).toMatch(/غير صالح/);
  });

  test("حذف طلب لا يمسّ الطلبات الأخرى إطلاقاً", async () => {
    const keep = await makeOrder();
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const remove = await makeOrder();

    expect((await deleteOrder(remove.id)).error).toBeNull();

    const [keptOrder] = await sql`select id from public.orders where id = ${keep.id}`;
    expect(keptOrder).toBeTruthy();
    const keptItems = await sql`select id from public.order_items where order_id = ${keep.id}`;
    expect(keptItems.length).toBeGreaterThan(0);
  });
});
