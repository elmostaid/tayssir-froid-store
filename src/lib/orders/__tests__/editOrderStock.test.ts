import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: vi.fn() }));
vi.mock("@/lib/notifications/notifyNewOrder", () => ({ notifyNewOrder: vi.fn() }));

const { updateOrderLines } = await import("@/lib/orders/updateOrderLines");

/**
 * تعديل طلب قائم: الإضافة، الدمج، والمخزون بالفرق وحده.
 *
 * السلوك الجديد الذي تحرسه هذه الاختبارات: سطرٌ لا يكفي مخزونه لم يعد
 * يُسقط التعديل كلَّه — يُحفظ بحالة out_of_stock ويصير الطلب needs_review،
 * وباقي السطور تُحفظ كاملة.
 */

const SKU_A = "EDIT-STK-A";
const SKU_B = "EDIT-STK-B";
const SKU_C = "EDIT-STK-C";
const ADMIN = "test-admin@tayssir.local";

let categoryId = 0;
const productIds: Record<string, number> = {};
const createdOrders: number[] = [];

async function setStock(sku: string, quantity: number) {
  await sql`update public.products set stock_quantity = ${quantity} where sku = ${sku}`;
}
async function stockOf(sku: string) {
  const [row] = await sql<{ stock_quantity: number }[]>`
    select stock_quantity from public.products where sku = ${sku}
  `;
  return row.stock_quantity;
}
async function orderRow(orderId: number) {
  const [row] = await sql<
    { status: string; items_subtotal: string; delivery_fee: string | null; final_total: string | null }[]
  >`select status, items_subtotal, delivery_fee, final_total from public.orders where id = ${orderId}`;
  return row;
}
async function itemsOf(orderId: number) {
  return sql<
    {
      sku_snapshot: string;
      quantity: number;
      unit_price_snapshot: string;
      line_status: string;
      line_status_reason: string | null;
      purchase_price_snapshot: string | null;
    }[]
  >`
    select sku_snapshot, quantity, unit_price_snapshot, line_status,
      line_status_reason, purchase_price_snapshot
    from public.order_items where order_id = ${orderId} order by sku_snapshot
  `;
}

/** طلب جاهز بسطر واحد محجوز فعلاً — نقطة الانطلاق لكل اختبار تعديل. */
async function seedOrder(lines: { sku: string; quantity: number; unitPrice: number }[]) {
  const [order] = await sql<{ id: number }[]>`
    insert into public.orders (
      customer_name, customer_phone, customer_city, customer_address,
      items_subtotal, delivery_fee, final_total, status, source, idempotency_key
    ) values (
      'زبون تعديل', '0669990001', 'مراكش', null,
      0, 30, 30, 'new', 'manual', ${`edit-stock-${Math.random()}`}
    ) returning id
  `;
  createdOrders.push(order.id);

  let subtotal = 0;
  for (const line of lines) {
    const productId = productIds[line.sku];
    await sql`
      update public.products set stock_quantity = stock_quantity - ${line.quantity}
      where id = ${productId}
    `;
    await sql`
      insert into public.order_items (
        order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
        unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status
      ) values (
        ${order.id}, ${productId}, null, ${`منتج ${line.sku}`}, ${line.sku},
        ${line.unitPrice}, ${line.quantity}, ${line.unitPrice * line.quantity}, 60, 'reserved'
      )
    `;
    subtotal += line.unitPrice * line.quantity;
  }
  await sql`
    update public.orders set items_subtotal = ${subtotal}, final_total = ${subtotal + 30}
    where id = ${order.id}
  `;
  return order.id;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;
  categoryId = category.id;

  for (const sku of [SKU_A, SKU_B, SKU_C]) {
    const [product] = await sql<{ id: number }[]>`
      insert into public.products (
        category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
        stock_quantity, min_order_qty, qty_increment, status
      ) values (
        ${categoryId}, ${sku}, ${sku.toLowerCase()}, ${`منتج ${sku}`}, 'قطعة',
        100, 60, 100, 1, 1, 'published'
      )
      on conflict (sku) do update set stock_quantity = 100, sale_price = 100, purchase_price = 60
      returning id
    `;
    productIds[sku] = product.id;
  }
});

beforeEach(async () => {
  for (const sku of [SKU_A, SKU_B, SKU_C]) await setStock(sku, 100);
});

afterAll(async () => {
  if (createdOrders.length > 0) {
    await sql`delete from public.orders where id = any(${createdOrders})`;
  }
  await sql`delete from public.products where sku = any(${[SKU_A, SKU_B, SKU_C]})`;
});

describe("إضافة منتج جديد إلى طلب قائم", () => {
  test("المنتج يُضاف، المخزون يُخصم مرة واحدة، والمجاميع تُعاد", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 2, unitPrice: 100 }]);
    expect(await stockOf(SKU_A)).toBe(98);

    const result = await updateOrderLines({
      orderId,
      items: [
        { productId: productIds[SKU_A], variantId: null, quantity: 2, unitPriceOverride: 100 },
        { productId: productIds[SKU_B], variantId: null, quantity: 3, unitPriceOverride: 90 },
      ],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsReview).toBe(false);
    expect(result.itemsSubtotal).toBe(2 * 100 + 3 * 90);
    // التوصيل الحالي (30) لم يتغيّر، والمجموع النهائي أُعيد حسابه فوقه.
    expect(result.deliveryFee).toBe(30);
    expect(result.finalTotal).toBe(2 * 100 + 3 * 90 + 30);

    // السطر القديم لم يُخصم مرة ثانية، والجديد خُصم مرة واحدة.
    expect(await stockOf(SKU_A)).toBe(98);
    expect(await stockOf(SKU_B)).toBe(97);

    const items = await itemsOf(orderId);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.line_status === "reserved")).toBe(true);

    const row = await orderRow(orderId);
    expect(row.status).toBe("new");
    expect(Number(row.final_total)).toBe(2 * 100 + 3 * 90 + 30);
  });

  test("إضافة منتج موجود أصلاً تزيد كميته بلا سطر مكرَّر", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 2, unitPrice: 100 }]);

    const result = await updateOrderLines({
      orderId,
      items: [
        { productId: productIds[SKU_A], variantId: null, quantity: 2, unitPriceOverride: 100 },
        { productId: productIds[SKU_A], variantId: null, quantity: 3, unitPriceOverride: 100 },
      ],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(result.ok).toBe(true);
    const items = await itemsOf(orderId);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
    // من 2 إلى 5 يحجز 3 فقط: 98 − 3 = 95.
    expect(await stockOf(SKU_A)).toBe(95);
  });
});

describe("المخزون يتحرّك بالفرق وحده", () => {
  test("إنقاص الكمية يُرجع الفارق فقط", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 5, unitPrice: 100 }]);
    expect(await stockOf(SKU_A)).toBe(95);

    await updateOrderLines({
      orderId,
      items: [{ productId: productIds[SKU_A], variantId: null, quantity: 2, unitPriceOverride: 100 }],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(await stockOf(SKU_A)).toBe(98);
  });

  test("حذف منتج يُرجع كميته المحجوزة كاملةً", async () => {
    const orderId = await seedOrder([
      { sku: SKU_A, quantity: 4, unitPrice: 100 },
      { sku: SKU_B, quantity: 1, unitPrice: 100 },
    ]);
    expect(await stockOf(SKU_B)).toBe(99);

    await updateOrderLines({
      orderId,
      items: [{ productId: productIds[SKU_A], variantId: null, quantity: 4, unitPriceOverride: 100 }],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(await stockOf(SKU_B)).toBe(100);
    expect(await stockOf(SKU_A)).toBe(96);
    expect(await itemsOf(orderId)).toHaveLength(1);
  });

  test("حفظ بلا أي تغيير لا يمسّ المخزون إطلاقاً", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 3, unitPrice: 100 }]);
    expect(await stockOf(SKU_A)).toBe(97);

    await updateOrderLines({
      orderId,
      items: [{ productId: productIds[SKU_A], variantId: null, quantity: 3, unitPriceOverride: 100 }],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(await stockOf(SKU_A)).toBe(97);
  });
});

describe("نقص المخزون لا يُضيّع الطلب", () => {
  test("السطر الناقص يُحفظ out_of_stock والطلب يصير needs_review وباقي السطور تنجو", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 2, unitPrice: 100 }]);
    await setStock(SKU_C, 1); // نطلب 10 والمتوفّر 1

    const result = await updateOrderLines({
      orderId,
      items: [
        { productId: productIds[SKU_A], variantId: null, quantity: 2, unitPriceOverride: 100 },
        { productId: productIds[SKU_B], variantId: null, quantity: 4, unitPriceOverride: 100 },
        { productId: productIds[SKU_C], variantId: null, quantity: 10, unitPriceOverride: 100 },
      ],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsReview).toBe(true);
    expect(result.outOfStock).toEqual([{ name: `منتج ${SKU_C}`, quantity: 10 }]);

    // الطلب كامل: ثلاثة سطور، لا سطر ضائع.
    const items = await itemsOf(orderId);
    expect(items).toHaveLength(3);
    const byStatus = Object.fromEntries(items.map((i) => [i.sku_snapshot, i.line_status]));
    expect(byStatus[SKU_A]).toBe("reserved");
    expect(byStatus[SKU_B]).toBe("reserved");
    expect(byStatus[SKU_C]).toBe("out_of_stock");

    const rejected = items.find((i) => i.sku_snapshot === SKU_C);
    expect(rejected?.line_status_reason).toContain("غير متوفرة في المخزون");
    expect(rejected?.quantity).toBe(10);

    // المخزون: السطر الناقص لم يُخصم، والسطر الجديد المتوفّر خُصم.
    expect(await stockOf(SKU_C)).toBe(1);
    expect(await stockOf(SKU_B)).toBe(96);

    const row = await orderRow(orderId);
    expect(row.status).toBe("needs_review");
    // المجموع يحتسب السطر المحفوظ كما طلبه المدير.
    expect(Number(row.items_subtotal)).toBe(2 * 100 + 4 * 100 + 10 * 100);
  });

  test("زيادة كمية سطر محجوز فوق المتاح تُرجع حجزه ولا تترك مخزوناً معلَّقاً", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 3, unitPrice: 100 }]);
    expect(await stockOf(SKU_A)).toBe(97);
    await setStock(SKU_A, 1); // متاح 1 فقط، والمطلوب الانتقال من 3 إلى 9

    const result = await updateOrderLines({
      orderId,
      items: [{ productId: productIds[SKU_A], variantId: null, quantity: 9, unitPriceOverride: 100 }],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsReview).toBe(true);

    // الحجز القديم (3) عاد إلى المخزون: 1 + 3 = 4، ولا شيء محجوز خفيةً.
    expect(await stockOf(SKU_A)).toBe(4);
    const items = await itemsOf(orderId);
    expect(items[0].line_status).toBe("out_of_stock");
    expect(items[0].quantity).toBe(9);
    expect((await orderRow(orderId)).status).toBe("needs_review");
  });

  test("تعديل لاحق بعد تصحيح المخزون يُعيد حجز السطر بلا خصم مزدوج", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 2, unitPrice: 100 }]);
    await setStock(SKU_C, 0);

    await updateOrderLines({
      orderId,
      items: [
        { productId: productIds[SKU_A], variantId: null, quantity: 2, unitPriceOverride: 100 },
        { productId: productIds[SKU_C], variantId: null, quantity: 5, unitPriceOverride: 100 },
      ],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });
    expect(await stockOf(SKU_C)).toBe(0);

    // المدير يصحّح المخزون ثم يحفظ من جديد بنفس الكمية.
    await setStock(SKU_C, 7);
    const second = await updateOrderLines({
      orderId,
      items: [
        { productId: productIds[SKU_A], variantId: null, quantity: 2, unitPriceOverride: 100 },
        { productId: productIds[SKU_C], variantId: null, quantity: 5, unitPriceOverride: 100 },
      ],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.needsReview).toBe(false);
    // خُصم 5 مرة واحدة فقط رغم أن السطر كان موجوداً في التعديل السابق.
    expect(await stockOf(SKU_C)).toBe(2);
    expect(await stockOf(SKU_A)).toBe(98);

    const items = await itemsOf(orderId);
    expect(items.every((i) => i.line_status === "reserved")).toBe(true);
  });
});

describe("الحسابات والربح", () => {
  test("ثمن الشراء يُقرأ من القاعدة لا من النموذج، والمجاميع تتبع الثمن الجديد", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 2, unitPrice: 100 }]);

    const result = await updateOrderLines({
      orderId,
      items: [{ productId: productIds[SKU_A], variantId: null, quantity: 4, unitPriceOverride: 85 }],
      deliveryFee: 45,
      changedByEmail: ADMIN,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itemsSubtotal).toBe(4 * 85);
    expect(result.deliveryFee).toBe(45);
    expect(result.finalTotal).toBe(4 * 85 + 45);

    const items = await itemsOf(orderId);
    // 60 هو ثمن الشراء المسجَّل في جدول المنتجات — لا ما قد يرسله المتصفح.
    expect(Number(items[0].purchase_price_snapshot)).toBe(60);
    // الربح الخام = 340 − 4×60 = 100 درهم.
    expect(4 * 85 - 4 * Number(items[0].purchase_price_snapshot)).toBe(100);
  });
});

describe("الإلغاء يُرجع المحجوز وحده", () => {
  test("طلب فيه سطر out_of_stock لا يُضخّم المخزون عند إلغائه", async () => {
    const orderId = await seedOrder([{ sku: SKU_A, quantity: 2, unitPrice: 100 }]);
    await setStock(SKU_C, 0);

    await updateOrderLines({
      orderId,
      items: [
        { productId: productIds[SKU_A], variantId: null, quantity: 2, unitPriceOverride: 100 },
        { productId: productIds[SKU_C], variantId: null, quantity: 6, unitPriceOverride: 100 },
      ],
      deliveryFee: null,
      changedByEmail: ADMIN,
    });

    expect(await stockOf(SKU_A)).toBe(98);
    expect(await stockOf(SKU_C)).toBe(0);

    // نفس استعلام الإرجاع المستعمَل في restockOrderInternal.
    const reserved = await sql<
      { product_id: number | null; variant_id: number | null; quantity: number }[]
    >`
      select product_id, variant_id, quantity from public.order_items
      where order_id = ${orderId} and line_status = 'reserved'
    `;
    for (const item of reserved) {
      await sql`
        update public.products set stock_quantity = stock_quantity + ${item.quantity}
        where id = ${item.product_id}
      `;
    }

    // A يعود إلى 100 (ما حُجز فعلاً)، وC يبقى 0 — لم تُخلَق ستّ قطع من عدم.
    expect(await stockOf(SKU_A)).toBe(100);
    expect(await stockOf(SKU_C)).toBe(0);
  });
});
