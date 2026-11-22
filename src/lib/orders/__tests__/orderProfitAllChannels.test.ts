import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * ربح الطلبية من القاعدة، لكل قناة إنشاء، وثباته عبر الزمن.
 *
 * المسار كما في الإنتاج: إنشاء الطلب بالدالة الحقيقية ← قراءة السطور بنفس
 * استعلام صفحة الطلب (getAdminOrderItems) ← نفس الحساب الذي يعرضه
 * OrderProfitPanel. Meta مُحاكاة بالكامل: لا حدث يغادر الاختبار.
 */

vi.mock("@/lib/pixel/capi", () => ({
  sendCapiEvent: vi.fn(async () => ({ ok: true, eventsReceived: 1, status: 200 })),
  isCapiConfigured: () => false,
  hashForCapi: (value: string) => `sha256(${value})`,
}));
vi.mock("@/lib/notifications/notifyNewOrder", () => ({ notifyNewOrder: vi.fn() }));

const { createOrder } = await import("@/lib/orders/createOrder");
const { createManualOrder } = await import("@/lib/orders/createManualOrder");
const { updateOrderLines } = await import("@/lib/orders/updateOrderLines");
const { getAdminOrderById, getAdminOrderItems } = await import("@/lib/queries/adminOrders");
const { computeOrderProfit } = await import("@/lib/orders/orderProfit");

const SKU_MOTOR = "PROFIT-CH-MOTOR";
const SKU_PART = "PROFIT-CH-PART";
const PHONE_PREFIX = "066123";
const ADMIN = "profit-test@tayssir.local";
let phoneCounter = 0;
const ids: Record<string, number> = {};

function customer() {
  phoneCounter += 1;
  return {
    fullName: "زبون اختبار الربح",
    phone: `${PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`,
    city: "الدار البيضاء",
    address: "عنوان اختبار",
    notes: null,
  };
}

/** الربح كما تعرضه صفحة الطلب، مقروءاً من القاعدة. */
async function profitOf(orderId: number) {
  const order = await getAdminOrderById(orderId);
  const items = await getAdminOrderItems(orderId);
  return computeOrderProfit({
    status: order!.status,
    lines: items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPriceSnapshot,
      purchasePriceSnapshot: i.purchasePriceSnapshot,
      currentPurchasePrice: i.currentPurchasePrice,
      lineStatus: i.lineStatus,
    })),
    deliveryFee: order!.deliveryFee,
    actualDeliveryCost: order!.actualDeliveryCost,
  });
}

/** طلب الموقع لا يُرجع رقمه الداخلي للمتصفح — نجده بمرجعه العام. */
async function idByReference(publicReference: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    select id from public.orders where public_reference = ${publicReference}
  `;
  return row.id;
}

async function setPurchasePrice(sku: string, price: number | null) {
  await sql`update public.products set purchase_price = ${price} where sku = ${sku}`;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  for (const [sku, sale, cost] of [
    [SKU_MOTOR, 300, 200],
    [SKU_PART, 20, 8],
  ] as const) {
    const [row] = await sql<{ id: number }[]>`
      insert into public.products (
        category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
        stock_quantity, min_order_qty, qty_increment, status
      ) values (
        ${category.id}, ${sku}, ${sku.toLowerCase()}, ${`منتج ${sku}`}, 'قطعة',
        ${sale}, ${cost}, 500, 1, 1, 'published'
      )
      on conflict (sku) do update set sale_price = ${sale}, purchase_price = ${cost}, stock_quantity = 500
      returning id
    `;
    ids[sku] = row.id;
  }
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone like ${PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku = any(${[SKU_MOTOR, SKU_PART]})`;
});

describe("الربح محفوظ لكل قناة إنشاء", () => {
  test("طلب الموقع (Checkout)", async () => {
    await setPurchasePrice(SKU_MOTOR, 200);
    const result = await createOrder({
      items: [{ productId: ids[SKU_MOTOR], variantId: null, quantity: 2 }],
      customer: customer(),
      idempotencyKey: randomUUID(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const profit = await profitOf(await idByReference(result.publicReference));
    expect(profit.salesMad).toBe(600);
    expect(profit.cogsMad).toBe(400);
    expect(profit.grossProfitMad).toBe(200);
    expect(profit.isEstimate).toBe(false);
  });

  test("طلب واتساب يُسجَّل من اللوحة، بثمن خاص متّفق عليه", async () => {
    await setPurchasePrice(SKU_MOTOR, 200);
    const result = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 35,
      createdByEmail: ADMIN,
      items: [
        { productId: ids[SKU_MOTOR], variantId: null, quantity: 3, unitPriceOverride: 280 },
        { productId: ids[SKU_PART], variantId: null, quantity: 10 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const profit = await profitOf(result.orderId);
    expect(profit.salesMad).toBe(3 * 280 + 10 * 20);
    expect(profit.cogsMad).toBe(3 * 200 + 10 * 8);
    expect(profit.grossProfitMad).toBe(1040 - 680);
    expect(profit.deliveryCollectedMad).toBe(35);
    // تكلفة التوصيل غير مسجَّلة ⇒ الربح بعد التوصيل غير معروف، لا مساوٍ للخام.
    expect(profit.deliveryCostMad).toBeNull();
    expect(profit.netProfitMad).toBeNull();
  });

  test("طلب يدوي (هاتف) بتكلفة توصيل مسجَّلة: يظهر الربح بعد التوصيل", async () => {
    await setPurchasePrice(SKU_MOTOR, 200);
    const result = await createManualOrder({
      customer: customer(),
      source: "phone",
      deliveryFee: 40,
      actualDeliveryCost: 55,
      createdByEmail: ADMIN,
      items: [{ productId: ids[SKU_MOTOR], variantId: null, quantity: 1 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const profit = await profitOf(result.orderId);
    expect(profit.grossProfitMad).toBe(100);
    expect(profit.deliveryMarginMad).toBe(-15);
    expect(profit.netProfitMad).toBe(85);
  });
});

describe("الربح التاريخي لا يتغيّر", () => {
  test("تغيير الحالة لا يمسّ الربح", async () => {
    await setPurchasePrice(SKU_MOTOR, 200);
    const result = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 0,
      createdByEmail: ADMIN,
      items: [{ productId: ids[SKU_MOTOR], variantId: null, quantity: 2 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = await profitOf(result.orderId);
    await sql`update public.orders set status = 'shipped' where id = ${result.orderId}`;
    const after = await profitOf(result.orderId);
    expect(after.grossProfitMad).toBe(before.grossProfitMad);
    expect(after.cogsMad).toBe(400);
  });

  test("ارتفاع ثمن الشراء في الكتالوغ لا يغيّر ربح طلب قديم", async () => {
    await setPurchasePrice(SKU_MOTOR, 200);
    const result = await createOrder({
      items: [{ productId: ids[SKU_MOTOR], variantId: null, quantity: 1 }],
      customer: customer(),
      idempotencyKey: randomUUID(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await setPurchasePrice(SKU_MOTOR, 260);
    const profit = await profitOf(await idByReference(result.publicReference));
    expect(profit.cogsMad).toBe(200);
    expect(profit.grossProfitMad).toBe(100);
  });

  test("تعديل محتوى الطلب بعد تغيّر ثمن الشراء يُبقي تكلفة يوم الطلب، والقطعة الجديدة تأخذ تكلفة اليوم", async () => {
    await setPurchasePrice(SKU_MOTOR, 200);
    await setPurchasePrice(SKU_PART, 8);
    const created = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 0,
      createdByEmail: ADMIN,
      items: [{ productId: ids[SKU_MOTOR], variantId: null, quantity: 2, unitPriceOverride: 300 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // الكتالوغ يتغيّر بعد الطلب، ثم يعدّل المدير الكمية ويضيف قطعة.
    await setPurchasePrice(SKU_MOTOR, 260);
    await setPurchasePrice(SKU_PART, 12);
    const edited = await updateOrderLines({
      orderId: created.orderId,
      items: [
        { productId: ids[SKU_MOTOR], variantId: null, quantity: 3, unitPriceOverride: 300 },
        { productId: ids[SKU_PART], variantId: null, quantity: 5, unitPriceOverride: 20 },
      ],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });
    expect(edited.ok).toBe(true);

    const items = await getAdminOrderItems(created.orderId);
    const motor = items.find((i) => i.skuSnapshot === SKU_MOTOR)!;
    const part = items.find((i) => i.skuSnapshot === SKU_PART)!;
    expect(Number(motor.purchasePriceSnapshot)).toBe(200); // يوم الطلب، لا 260
    expect(Number(part.purchasePriceSnapshot)).toBe(12); // أُضيفت اليوم بثمن اليوم

    const profit = await profitOf(created.orderId);
    expect(profit.cogsMad).toBe(3 * 200 + 5 * 12);
    expect(profit.grossProfitMad).toBe(3 * 300 + 5 * 20 - (3 * 200 + 5 * 12));
    expect(profit.isEstimate).toBe(false);
  });

  test("سطر قديم بلا تكلفة محفوظة يبقى بلا تكلفة بعد التعديل، ولا يُكتب ثمن اليوم مكانه", async () => {
    await setPurchasePrice(SKU_MOTOR, 200);
    const created = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 0,
      createdByEmail: ADMIN,
      items: [{ productId: ids[SKU_MOTOR], variantId: null, quantity: 1 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // محاكاة طلب سبق حفظ التكلفة.
    await sql`update public.order_items set purchase_price_snapshot = null where order_id = ${created.orderId}`;

    await setPurchasePrice(SKU_MOTOR, 230);
    const edited = await updateOrderLines({
      orderId: created.orderId,
      items: [{ productId: ids[SKU_MOTOR], variantId: null, quantity: 2, unitPriceOverride: 300 }],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });
    expect(edited.ok).toBe(true);

    const items = await getAdminOrderItems(created.orderId);
    expect(items[0].purchasePriceSnapshot).toBeNull();
    const profit = await profitOf(created.orderId);
    // يُعرض تقديراً موسوماً بثمن اليوم، لا رقماً تاريخياً مؤكَّداً.
    expect(profit.isEstimate).toBe(true);
    expect(profit.cogsMad).toBe(460);
  });

  test("منتج بلا أي ثمن شراء: الربح غير معروف، لا صفر", async () => {
    await setPurchasePrice(SKU_PART, null);
    const result = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 0,
      createdByEmail: ADMIN,
      items: [{ productId: ids[SKU_PART], variantId: null, quantity: 4 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const profit = await profitOf(result.orderId);
    expect(profit.cogsMad).toBeNull();
    expect(profit.grossProfitMad).toBeNull();
    expect(profit.linesWithoutCost).toBe(1);
    await setPurchasePrice(SKU_PART, 8);
  });
});
