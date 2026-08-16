import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";

// هذه اختبارات تكامل حقيقية تحتاج قاعدة بيانات حية (نفس نمط
// createOrder.test.ts). getAdminUser() تحتاج جلسة Supabase Auth حقيقية غير
// متاحة في بيئة الاختبار — نُحاكيها هنا فقط (مدير وهمي)، دون المساس بمنطق
// الحماية الحقيقي نفسه (لا يزال pageGuards.test.ts وrequireAdmin.test.ts
// يتحققان منه بشكل منفصل).
vi.mock("@/lib/auth/requireAdmin", () => ({
  getAdminUser: vi.fn().mockResolvedValue({ id: "test-admin", email: "test-admin@local" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateOrderStatus, cancelOrderAction } = await import("@/app/admin/(protected)/orders/actions");

const TEST_PHONE_PREFIX = "061111";
let phoneCounter = 0;
function nextTestPhone(): string {
  phoneCounter += 1;
  return `${TEST_PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`;
}

async function getStock(productId: number): Promise<number> {
  const [row] = await sql<{ stock_quantity: number }[]>`
    select stock_quantity from public.products where id = ${productId}
  `;
  return row.stock_quantity;
}

function statusForm(orderId: number, status: string, note = ""): FormData {
  const fd = new FormData();
  fd.set("orderId", String(orderId));
  fd.set("status", status);
  fd.set("note", note);
  return fd;
}

function cancelForm(orderId: number, note = ""): FormData {
  const fd = new FormData();
  fd.set("orderId", String(orderId));
  fd.set("note", note);
  return fd;
}

let fixtureProductId: number;
let fixtureProduct2Id: number;
let fixtureVariantId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-ORDERS-ACTIONS', 'test-fixture-orders-actions', ${category.id},
      'منتج اختبار إجراءات الطلبات', 'قطعة', 1, 1, 200.00, 350.00, 200, 'published'
    )
    on conflict (sku) do update set stock_quantity = 200
    returning id
  `;
  fixtureProductId = product.id;

  const [product2] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-ORDERS-ACTIONS-2', 'test-fixture-orders-actions-2', ${category.id},
      'منتج اختبار إجراءات الطلبات 2 (بمتغيّر)', 'قطعة', 1, 1, 50.00, 90.00, 200, 'published'
    )
    on conflict (sku) do update set stock_quantity = 200
    returning id
  `;
  fixtureProduct2Id = product2.id;

  const [variant] = await sql<{ id: number }[]>`
    insert into public.product_variants (product_id, variant_name, stock_quantity, is_active)
    values (${fixtureProduct2Id}, 'متغيّر اختبار', 200, true)
    on conflict (product_id, variant_name) do update set stock_quantity = 200
    returning id
  `;
  fixtureVariantId = variant.id;
});

afterAll(async () => {
  await sql`delete from public.stock_movements where product_id in (${fixtureProductId}, ${fixtureProduct2Id})`;
  await sql`delete from public.orders where customer_phone like ${TEST_PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku in ('TEST-FIXTURE-ORDERS-ACTIONS', 'TEST-FIXTURE-ORDERS-ACTIONS-2')`;
});

beforeEach(async () => {
  await sql`update public.products set stock_quantity = 200 where id in (${fixtureProductId}, ${fixtureProduct2Id})`;
  await sql`update public.product_variants set stock_quantity = 200 where id = ${fixtureVariantId}`;
});

async function makeOrder(quantity: number): Promise<number> {
  const result = await createOrder({
    items: [{ productId: fixtureProductId, variantId: null, quantity }],
    customer: {
      fullName: "زبون اختبار الإجراءات",
      phone: nextTestPhone(),
      city: "الرباط",
      address: "شارع تجريبي",
      notes: null,
    },
    idempotencyKey: randomUUID(),
  });
  if (!result.ok) throw new Error("test order creation failed: " + JSON.stringify(result.errors));
  const [row] = await sql<{ id: number }[]>`
    select id from public.orders where public_reference = ${result.publicReference}
  `;
  return row.id;
}

async function makeMixedOrder(
  productQuantity: number,
  variantQuantity: number
): Promise<number> {
  const result = await createOrder({
    items: [
      { productId: fixtureProductId, variantId: null, quantity: productQuantity },
      { productId: fixtureProduct2Id, variantId: fixtureVariantId, quantity: variantQuantity },
    ],
    customer: {
      fullName: "زبون اختبار الإجراءات (متعدد الأسطر)",
      phone: nextTestPhone(),
      city: "الرباط",
      address: "شارع تجريبي",
      notes: null,
    },
    idempotencyKey: randomUUID(),
  });
  if (!result.ok) throw new Error("test order creation failed: " + JSON.stringify(result.errors));
  const [row] = await sql<{ id: number }[]>`
    select id from public.orders where public_reference = ${result.publicReference}
  `;
  return row.id;
}

async function getVariantStock(variantId: number): Promise<number> {
  const [row] = await sql<{ stock_quantity: number }[]>`
    select stock_quantity from public.product_variants where id = ${variantId}
  `;
  return row.stock_quantity;
}

describe("updateOrderStatus — تغيير الحالة العادي لا يمس المخزون", () => {
  test("الانتقال عبر confirmed/preparing/shipped/delivered لا يغيّر المخزون إطلاقاً", async () => {
    const orderId = await makeOrder(10);
    const stockAfterCreate = await getStock(fixtureProductId);

    for (const status of ["confirmed", "preparing", "shipped", "delivered"]) {
      const result = await updateOrderStatus({ error: null }, statusForm(orderId, status));
      expect(result.error).toBeNull();
    }

    expect(await getStock(fixtureProductId)).toBe(stockAfterCreate);
  });
});

describe("cancelOrderAction — الإلغاء يُرجع المخزون مرة واحدة فقط", () => {
  test("الإلغاء يُرجع الكمية بالضبط، ومنع إلغاء مزدوج", async () => {
    const stockBefore = await getStock(fixtureProductId);
    const orderId = await makeOrder(7);
    expect(await getStock(fixtureProductId)).toBe(stockBefore - 7);

    const first = await cancelOrderAction({ error: null }, cancelForm(orderId));
    expect(first.error).toBeNull();
    expect(await getStock(fixtureProductId)).toBe(stockBefore);

    const second = await cancelOrderAction({ error: null }, cancelForm(orderId));
    expect(second.error).not.toBeNull();
    // لا استرجاع مزدوج: المخزون يبقى كما هو بعد المحاولة الثانية المرفوضة.
    expect(await getStock(fixtureProductId)).toBe(stockBefore);
  });
});

describe("updateOrderStatus(returned) — نفس ضمان الإلغاء بالضبط", () => {
  test("راجع يُرجع الكمية مرة واحدة، ومنع راجع مزدوج", async () => {
    const stockBefore = await getStock(fixtureProductId);
    const orderId = await makeOrder(4);
    expect(await getStock(fixtureProductId)).toBe(stockBefore - 4);

    const first = await updateOrderStatus({ error: null }, statusForm(orderId, "returned"));
    expect(first.error).toBeNull();
    expect(await getStock(fixtureProductId)).toBe(stockBefore);

    const second = await updateOrderStatus({ error: null }, statusForm(orderId, "returned"));
    expect(second.error).not.toBeNull();
    expect(await getStock(fixtureProductId)).toBe(stockBefore);
  });

  test("ملغى→راجع وراجع→ملغى ممنوعان (اتجاه معاكس)، بدون استرجاع مزدوج", async () => {
    const stockBefore = await getStock(fixtureProductId);
    const orderId = await makeOrder(5);

    const cancelled = await cancelOrderAction({ error: null }, cancelForm(orderId));
    expect(cancelled.error).toBeNull();
    expect(await getStock(fixtureProductId)).toBe(stockBefore);

    const returnedAfterCancel = await updateOrderStatus({ error: null }, statusForm(orderId, "returned"));
    expect(returnedAfterCancel.error).not.toBeNull();
    expect(await getStock(fixtureProductId)).toBe(stockBefore);
  });

  test("كل حركة استرجاع مسجَّلة في stock_movements بالسبب الصحيح", async () => {
    const orderId = await makeOrder(3);
    await updateOrderStatus({ error: null }, statusForm(orderId, "returned"));

    const movements = await sql<{ reason: string; quantity_delta: number }[]>`
      select reason, quantity_delta from public.stock_movements
      where order_id = ${orderId} order by created_at asc
    `;
    expect(movements).toEqual([
      { reason: "order_created", quantity_delta: -3 },
      { reason: "order_returned", quantity_delta: 3 },
    ]);
  });
});

describe("restockOrderInternal — طلب بعدة أسطر مختلطة (منتج بسيط + متغيّر)", () => {
  test("الإلغاء يُرجع مخزون كل الأسطر (المنتج البسيط والمتغيّر) بشكل صحيح", async () => {
    const productStockBefore = await getStock(fixtureProductId);
    const variantStockBefore = await getVariantStock(fixtureVariantId);

    const orderId = await makeMixedOrder(6, 9);
    expect(await getStock(fixtureProductId)).toBe(productStockBefore - 6);
    expect(await getVariantStock(fixtureVariantId)).toBe(variantStockBefore - 9);

    const result = await cancelOrderAction({ error: null }, cancelForm(orderId));
    expect(result.error).toBeNull();
    expect(await getStock(fixtureProductId)).toBe(productStockBefore);
    expect(await getVariantStock(fixtureVariantId)).toBe(variantStockBefore);
  });

  test("حركات المخزون المُسجَّلة عند الإلغاء تطابق كل سطر (product_id أو variant_id) بالكمية الصحيحة", async () => {
    const orderId = await makeMixedOrder(2, 5);
    await cancelOrderAction({ error: null }, cancelForm(orderId));

    const movements = await sql<
      { product_id: number | null; variant_id: number | null; quantity_delta: number; reason: string }[]
    >`
      select product_id, variant_id, quantity_delta, reason
      from public.stock_movements
      where order_id = ${orderId} and reason = 'order_cancelled'
      order by variant_id nulls first
    `;
    expect(movements).toEqual([
      { product_id: fixtureProductId, variant_id: null, quantity_delta: 2, reason: "order_cancelled" },
      {
        product_id: fixtureProduct2Id,
        variant_id: fixtureVariantId,
        quantity_delta: 5,
        reason: "order_cancelled",
      },
    ]);
  });
});
