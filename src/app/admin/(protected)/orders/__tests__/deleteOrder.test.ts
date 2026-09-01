import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";

// اختبار تكامل حقيقي على قاعدة بيانات حية — الهدف منه بالذات التحقّق من أن
// الحذف يعتمد فعلاً على المفاتيح الأجنبية الموجودة في المخطَّط (CASCADE على
// order_items وorder_status_history، وSET NULL على stock_movements). محاكاة
// القاعدة هنا كانت ستُخفي بالضبط ما نريد إثباته.
//
// وصار للحذف واجبان إضافيان يختبرهما هذا الملف: إرجاع المخزون **مرة واحدة**،
// وكتابة سجل في order_deletions. قبلهما كان الحذف يترك الكميات مخصومة إلى
// الأبد (2,103 وحدة عبر 144 منتجاً على الإنتاج) بلا أي أثر لمن حذف ولا لما
// كان في الطلب.
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
  revalidateTag: vi.fn(),
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
    requestContext: undefined,
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
  await sql`delete from public.order_deletions where customer_phone like ${TEST_PHONE_PREFIX + "%"}`;
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

  test("الحذف يُرجِع الكمية المحجوزة إلى المخزون", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const order = await makeOrder();
    const [before] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;

    expect((await deleteOrder(order.id)).error).toBeNull();

    const [after] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;
    // makeOrder يحجز 4 قطع؛ الحذف يُعيدها.
    expect(after.stock_quantity).toBe(before.stock_quantity + 4);
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

describe("deleteOrder — إرجاع المخزون مرة واحدة", () => {
  test("طلب مُلغى أرجع مخزونه سابقاً: الحذف لا يُرجعه ثانيةً", async () => {
    const order = await makeOrder();
    // نُحاكي ما يفعله الإلغاء: المخزون يعود، والحالة تصير cancelled.
    await sql`
      update public.products set stock_quantity = stock_quantity + 4
      where id = ${fixtureProductId}
    `;
    await sql`
      insert into public.stock_movements (product_id, variant_id, order_id, quantity_delta, reason)
      values (${fixtureProductId}, null, ${order.id}, 4, 'order_cancelled')
    `;
    await sql`update public.orders set status = 'cancelled' where id = ${order.id}`;

    const [before] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;

    getAdminUserMock.mockResolvedValueOnce(OWNER);
    expect((await deleteOrder(order.id)).error).toBeNull();

    const [after] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;
    // لو أرجعه الحذف ثانيةً لصار +4 — أي قطع لا وجود لها في المستودع.
    expect(after.stock_quantity).toBe(before.stock_quantity);
  });

  test("طلب راجع (returned): نفس القاعدة", async () => {
    const order = await makeOrder();
    await sql`
      update public.products set stock_quantity = stock_quantity + 4
      where id = ${fixtureProductId}
    `;
    await sql`update public.orders set status = 'returned' where id = ${order.id}`;

    const [before] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    expect((await deleteOrder(order.id)).error).toBeNull();

    const [after] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;
    expect(after.stock_quantity).toBe(before.stock_quantity);
  });

  test("سطر out_of_stock لم يُخصم قط، فلا يُرجَع", async () => {
    const order = await makeOrder();
    // سطر إضافي لم يُحجز مخزونه — كما يكتبه طلب الموقع عند نفاد قطعة.
    await sql`
      insert into public.order_items (
        order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
        unit_price_snapshot, quantity, line_total, line_status, line_status_reason
      ) values (
        ${order.id}, ${fixtureProductId}, null, 'منتج اختبار حذف الطلبات',
        'TEST-FIXTURE-DELETE-ORDER', 300, 7, 2100, 'out_of_stock', 'نفد المخزون'
      )
    `;

    const [before] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    expect((await deleteOrder(order.id)).error).toBeNull();

    const [after] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;
    // يعود 4 (المحجوز) فقط، لا 11.
    expect(after.stock_quantity).toBe(before.stock_quantity + 4);
  });

  test("حركة الإرجاع تُسجَّل بسبب order_deleted", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const order = await makeOrder();
    expect((await deleteOrder(order.id)).error).toBeNull();

    const moves = await sql<{ quantity_delta: number }[]>`
      select quantity_delta from public.stock_movements
      where product_id = ${fixtureProductId} and reason = 'order_deleted'
        and quantity_delta = 4
    `;
    expect(moves.length).toBeGreaterThanOrEqual(1);
  });
});

describe("deleteOrder — سجل الحذف", () => {
  test("يحفظ الطلب وسطوره ومن حذفه وكم أُرجع", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const order = await makeOrder();

    expect((await deleteOrder(order.id)).error).toBeNull();

    const [log] = await sql<
      {
        order_number: string;
        status_at_deletion: string;
        customer_name: string;
        stock_restored: boolean;
        restored_units: number;
        deleted_by: string;
        items: { quantity: number; sku_snapshot: string }[];
      }[]
    >`
      select order_number, status_at_deletion, customer_name, stock_restored,
             restored_units, deleted_by, items
      from public.order_deletions where order_id = ${order.id}
    `;

    expect(log).toBeDefined();
    expect(log.order_number).toBe(order.orderNumber);
    expect(log.status_at_deletion).toBe("new");
    expect(log.customer_name).toBe("زبون اختبار الحذف");
    expect(log.stock_restored).toBe(true);
    expect(log.restored_units).toBe(4);
    expect(log.deleted_by).toBe(OWNER.email);
    // لقطة السطور تبقى بعد أن يمحو CASCADE جدول order_items.
    expect(log.items.length).toBeGreaterThan(0);
    expect(log.items[0].quantity).toBe(4);
  });

  test("طلب مُلغى: السجل يقول صراحةً إنه لم يُرجَع شيء", async () => {
    const order = await makeOrder();
    await sql`
      update public.products set stock_quantity = stock_quantity + 4
      where id = ${fixtureProductId}
    `;
    await sql`update public.orders set status = 'cancelled' where id = ${order.id}`;

    getAdminUserMock.mockResolvedValueOnce(OWNER);
    expect((await deleteOrder(order.id)).error).toBeNull();

    const [log] = await sql<{ stock_restored: boolean; restored_units: number }[]>`
      select stock_restored, restored_units from public.order_deletions
      where order_id = ${order.id}
    `;
    expect(log.stock_restored).toBe(false);
    expect(log.restored_units).toBe(0);
  });

  test("الطلب اختفى والسجل باقٍ — وهو كل ما يبقى منه", async () => {
    getAdminUserMock.mockResolvedValueOnce(OWNER);
    const order = await makeOrder();
    expect((await deleteOrder(order.id)).error).toBeNull();

    expect((await sql`select id from public.orders where id = ${order.id}`).length).toBe(0);
    expect(
      (await sql`select id from public.order_deletions where order_id = ${order.id}`).length
    ).toBe(1);
  });

  test("حذف مرفوض (Staff): لا سجل ولا حركة مخزون", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF);
    const order = await makeOrder();
    expect((await deleteOrder(order.id)).error).toBeTruthy();

    expect(
      (await sql`select id from public.order_deletions where order_id = ${order.id}`).length
    ).toBe(0);
  });
});
