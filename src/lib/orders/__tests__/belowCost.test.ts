import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

const sendCapiEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));

const { createManualOrder } = await import("@/lib/orders/createManualOrder");
const { updateOrderLines } = await import("@/lib/orders/updateOrderLines");
const { findBelowCostLines } = await import("@/lib/orders/belowCost");

/**
 * الحارس يقف **قبل** أي كتابة. كل حالة هنا تتحقّق من الأمرين معاً: أن
 * الطلب رُفض، وأن المخزون لم يتحرّك ولا وحدة واحدة.
 */

const PHONE = "0655880001";
const SKUS = ["BC-FIX-001", "BC-FIX-002"];

const product = async (sku: string) =>
  (
    await sql<{ id: number; stock_quantity: number }[]>`
      select id, stock_quantity from public.products where sku = ${sku}
    `
  )[0];
const stockOf = async (sku: string) => (await product(sku)).stock_quantity;

const customer = () => ({
  fullName: "زبون",
  phone: PHONE,
  city: "مراكش",
  address: "عنوان",
  notes: null,
});

const base = {
  source: "whatsapp" as const,
  deliveryFee: 0,
  createdByEmail: "admin@test.local",
};

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values
    ('BC-FIX-001', 'bc-fix-001', ${category.id}, 'غاز R22', 'قطعة', 1, 1, 300.00, 350.00, 50, 'published'),
    ('BC-FIX-002', 'bc-fix-002', ${category.id}, 'قطعة بلا تكلفة', 'قطعة', 1, 1, null, 100.00, 50, 'published')
    on conflict (sku) do nothing
  `;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone = ${PHONE}`;
  await sql`delete from public.products where sku = any(${SKUS})`;
});

describe("كشف السطور الخاسرة", () => {
  const line = (unitPrice: number, purchase: number | null, quantity = 1) => ({
    productId: 1,
    variantId: null,
    nameSnapshot: "منتج",
    skuSnapshot: "X",
    unitPrice,
    quantity,
    lineTotal: unitPrice * quantity,
    purchasePriceSnapshot: purchase,
  });

  test("فوق التكلفة: لا شيء", () => {
    expect(findBelowCostLines([line(350, 300)])).toEqual([]);
  });

  test("يساوي التكلفة: ربح صفر لا خسارة — لا حارس", () => {
    expect(findBelowCostLines([line(300, 300)])).toEqual([]);
  });

  test("تحت التكلفة: يحسب الخسارة في القطعة وفي السطر", () => {
    const [found] = findBelowCostLines([line(50, 300, 3)]);
    expect(found.lossPerUnit).toBe(250);
    expect(found.lossTotal).toBe(750);
  });

  test("تكلفة مجهولة ليست خسارة", () => {
    expect(findBelowCostLines([line(10, null)])).toEqual([]);
  });
});

describe("إنشاء طلب يدوي — الحارس", () => {
  test("سعر فوق التكلفة: يُنشأ عادياً", async () => {
    const p = await product("BC-FIX-001");
    const before = await stockOf("BC-FIX-001");
    const result = await createManualOrder({
      ...base,
      customer: customer(),
      items: [{ productId: p.id, variantId: null, quantity: 2, unitPriceOverride: 400 }],
    });
    expect(result.ok).toBe(true);
    expect(await stockOf("BC-FIX-001")).toBe(before - 2);
  });

  test("سعر يساوي التكلفة: يُنشأ عادياً بربح صفر", async () => {
    const p = await product("BC-FIX-001");
    const before = await stockOf("BC-FIX-001");
    const result = await createManualOrder({
      ...base,
      customer: customer(),
      items: [{ productId: p.id, variantId: null, quantity: 1, unitPriceOverride: 300 }],
    });
    expect(result.ok).toBe(true);
    expect(await stockOf("BC-FIX-001")).toBe(before - 1);
  });

  test("سعر تحت التكلفة بلا إقرار: يُرفض، والمخزون لا يتحرّك", async () => {
    const p = await product("BC-FIX-001");
    const before = await stockOf("BC-FIX-001");

    const result = await createManualOrder({
      ...base,
      customer: customer(),
      items: [{ productId: p.id, variantId: null, quantity: 3, unitPriceOverride: 50 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].field).toBe("belowCost");
      expect(result.errors[0].message).toContain("غاز R22");
      expect(result.errors[0].message).toContain("250"); // الخسارة في القطعة
      expect(result.errors[0].message).toContain("750"); // الخسارة في السطر
    }
    expect(await stockOf("BC-FIX-001")).toBe(before);
    expect(
      await sql`select 1 from public.orders where customer_phone = ${PHONE} and items_subtotal = 150`
    ).toHaveLength(0);
  });

  test("بعد الإقرار الصريح: يُنشأ ويخصم المخزون مرة واحدة", async () => {
    const p = await product("BC-FIX-001");
    const before = await stockOf("BC-FIX-001");

    const result = await createManualOrder({
      ...base,
      customer: customer(),
      items: [{ productId: p.id, variantId: null, quantity: 3, unitPriceOverride: 50 }],
      acknowledgeBelowCost: true,
    });

    expect(result.ok).toBe(true);
    expect(await stockOf("BC-FIX-001")).toBe(before - 3);
  });

  test("منتج بلا ثمن شراء لا يُوقفه الحارس", async () => {
    const p = await product("BC-FIX-002");
    const result = await createManualOrder({
      ...base,
      customer: customer(),
      items: [{ productId: p.id, variantId: null, quantity: 1, unitPriceOverride: 1 }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("تعديل طلب قائم — نفس الحارس", () => {
  async function seed() {
    const p = await product("BC-FIX-001");
    const result = await createManualOrder({
      ...base,
      customer: customer(),
      items: [{ productId: p.id, variantId: null, quantity: 2 }],
    });
    if (!result.ok) throw new Error("تعذّر التهيئة");
    return { orderId: result.orderId, productId: p.id };
  }

  test("خفض الثمن تحت التكلفة بلا إقرار: يُرفض والطلب يبقى كما هو", async () => {
    const { orderId, productId } = await seed();
    const stockBefore = await stockOf("BC-FIX-001");

    const result = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 2, unitPriceOverride: 100 }],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].field).toBe("belowCost");
    expect(await stockOf("BC-FIX-001")).toBe(stockBefore);

    const [row] = await sql<{ unit_price_snapshot: string }[]>`
      select unit_price_snapshot from public.order_items where order_id = ${orderId}
    `;
    expect(Number(row.unit_price_snapshot)).toBe(350);
  });

  test("بعد الإقرار: يُحفَظ التعديل", async () => {
    const { orderId, productId } = await seed();
    const result = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 2, unitPriceOverride: 100 }],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
      acknowledgeBelowCost: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.itemsSubtotal).toBe(200);
  });
});
