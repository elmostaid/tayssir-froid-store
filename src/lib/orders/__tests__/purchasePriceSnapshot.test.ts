import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";
import type { CreateOrderInput } from "@/lib/orders/types";
import { getDeliveredOrdersProfitBreakdown, getProfitSummary } from "@/lib/queries/adminReports";

// اختبارات purchase_price_snapshot (migration 20260807000000):
// 1) createOrder() يخزّن ثمن الشراء الفعلي وقت الطلب (product أو variant).
// 2) تغيير purchase_price لمنتج بعد تسليم طلب لا يغيّر ربح ذلك الطلب القديم
//    (لأنه يعتمد الآن على الـsnapshot المحفوظ، لا على السعر الحالي).
// 3) طلب "قديم" (بدون snapshot، يُحاكى بإدخال مباشر لمحاكاة ما قبل الهجرة)
//    يستمر فـيعتمد على السعر الحالي كـ"تقدير تاريخي" فقط — ويتأثر فعلاً
//    بتغييره لاحقاً، بعكس الطلبات الجديدة.
const TEST_PHONE_PREFIX = "061111";
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `${TEST_PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`;
}

function baseCustomer() {
  return {
    fullName: "زبون اختبار snapshot",
    phone: nextPhone(),
    city: "الدار البيضاء",
    address: "عنوان اختبار",
    notes: null,
  };
}

let productId: number;
let variantId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;

  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-SNAPSHOT', 'test-fixture-snapshot', ${category.id},
      'منتج اختبار snapshot', 'قطعة', 1, 1, 100.00, 350.00, 200, 'published'
    )
    on conflict (sku) do update set purchase_price = 100.00, sale_price = 350.00, stock_quantity = 200
    returning id
  `;
  productId = product.id;

  const [variant] = await sql<{ id: number }[]>`
    insert into public.product_variants (
      product_id, variant_name, sale_price_override, purchase_price_override, stock_quantity
    ) values (
      ${productId}, 'نوع اختبار snapshot', 400.00, 150.00, 200
    )
    on conflict (product_id, variant_name) do update set
      sale_price_override = 400.00, purchase_price_override = 150.00, stock_quantity = 200
    returning id
  `;
  variantId = variant.id;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone like ${TEST_PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-SNAPSHOT'`;
});

describe("createOrder — تخزين purchase_price_snapshot وقت إنشاء الطلب", () => {
  test("يخزّن product.purchase_price الحالي حين لا يوجد variant", async () => {
    const input: CreateOrderInput = {
      items: [{ productId, variantId: null, quantity: 3 }], // 3 × 350 = 1050
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };
    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await sql<{ purchase_price_snapshot: string }[]>`
      select oi.purchase_price_snapshot
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.public_reference = ${result.publicReference}
    `;
    expect(Number(row.purchase_price_snapshot)).toBe(100);
  });

  test("يفضّل variant.purchase_price_override على ثمن شراء المنتج الأصلي", async () => {
    const input: CreateOrderInput = {
      items: [{ productId, variantId, quantity: 3 }], // 3 × 400 = 1200
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };
    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await sql<{ purchase_price_snapshot: string }[]>`
      select oi.purchase_price_snapshot
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.public_reference = ${result.publicReference}
    `;
    expect(Number(row.purchase_price_snapshot)).toBe(150);
  });
});

describe("ثبات الربح التاريخي — تعديل purchase price بعد التسليم لا يغيّر ربح الطلب القديم", () => {
  test("طلب مسلَّم يحتفظ بنفس الربح بعد تغيير ثمن شراء المنتج لاحقاً", async () => {
    const input: CreateOrderInput = {
      items: [{ productId, variantId: null, quantity: 4 }], // 4 × 350 = 1400، تكلفة 4 × 100 = 400، ربح 1000
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };
    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [order] = await sql<{ id: number }[]>`
      select id from public.orders where public_reference = ${result.publicReference}
    `;
    await sql`update public.orders set status = 'delivered' where id = ${order.id}`;

    const beforePriceChange = await getDeliveredOrdersProfitBreakdown(200);
    const rowBefore = beforePriceChange.find((r) => r.orderId === order.id);
    expect(rowBefore).toBeDefined();
    expect(Number(rowBefore?.cogsMad)).toBeCloseTo(400, 2);
    expect(Number(rowBefore?.profitMad)).toBeCloseTo(1000, 2);
    expect(rowBefore?.isExactHistoricalProfit).toBe(true);

    try {
      // محاكاة تعديل ثمن الشراء لاحقاً من لوحة الإدارة (مثلاً المورّد غيّر
      // سعره) — يجب ألا يمس هذا ربح الطلب القديم المسلَّم فعلاً.
      await sql`update public.products set purchase_price = 999.00 where id = ${productId}`;

      const afterPriceChange = await getDeliveredOrdersProfitBreakdown(200);
      const rowAfter = afterPriceChange.find((r) => r.orderId === order.id);
      expect(rowAfter).toBeDefined();
      expect(Number(rowAfter?.cogsMad)).toBeCloseTo(400, 2);
      expect(Number(rowAfter?.profitMad)).toBeCloseTo(1000, 2);
    } finally {
      await sql`update public.products set purchase_price = 100.00 where id = ${productId}`;
    }
  });
});

describe("طلبات سابقة للهجرة (بدون snapshot) — تقدير تاريخي فقط، يتأثر بتغيير السعر الحالي", () => {
  test("طلب بدون purchase_price_snapshot يعتمد على السعر الحالي، ويُوسَم isExactHistoricalProfit=false", async () => {
    // محاكاة طلب "قديم" أُنشئ قبل إضافة العمود: إدخال مباشر لـorders/
    // order_items متجاوزاً createOrder() بحيث purchase_price_snapshot = NULL
    // صراحة (القيمة الافتراضية لأي صف قديم فعلاً بعد الهجرة).
    const legacyPhone = nextPhone();
    const [legacyOrder] = await sql<{ id: number }[]>`
      insert into public.orders (
        customer_name, customer_phone, customer_city, customer_address,
        items_subtotal, status, source
      ) values (
        'زبون طلب قديم محاكى', ${legacyPhone}, 'فاس', 'عنوان قديم',
        700.00, 'delivered', 'website'
      )
      returning id
    `;

    await sql`
      insert into public.order_items (
        order_id, product_id, variant_id, product_name_snapshot,
        sku_snapshot, unit_price_snapshot, quantity, line_total,
        purchase_price_snapshot
      ) values (
        ${legacyOrder.id}, ${productId}, null, 'منتج اختبار snapshot',
        'TEST-FIXTURE-SNAPSHOT', 350.00, 2, 700.00,
        null
      )
    `;

    const summaryBefore = await getProfitSummary();
    const breakdownAtCurrentPrice = await getDeliveredOrdersProfitBreakdown(500);
    const rowAtCurrentPrice = breakdownAtCurrentPrice.find((r) => r.orderId === legacyOrder.id);

    expect(rowAtCurrentPrice).toBeDefined();
    expect(rowAtCurrentPrice?.isExactHistoricalProfit).toBe(false);
    // ثمن الشراء الحالي وقت هذا الاختبار = 100.00 (لم يتغيّر بعد) => تكلفة 2×100=200
    expect(Number(rowAtCurrentPrice?.cogsMad)).toBeCloseTo(200, 2);
    expect(Number(rowAtCurrentPrice?.profitMad)).toBeCloseTo(500, 2);
    expect(summaryBefore.approximateProfitOrdersCount).toBeGreaterThanOrEqual(1);

    try {
      // على عكس الطلب الجديد فالاختبار السابق، هذا الطلب "القديم" يتأثر
      // فعلاً بتغيير السعر الحالي — هذا هو الـfallback الآمن الموثَّق، وليس
      // خللاً.
      await sql`update public.products set purchase_price = 300.00 where id = ${productId}`;

      const breakdownAfterPriceChange = await getDeliveredOrdersProfitBreakdown(500);
      const rowAfterPriceChange = breakdownAfterPriceChange.find((r) => r.orderId === legacyOrder.id);
      expect(rowAfterPriceChange).toBeDefined();
      expect(Number(rowAfterPriceChange?.cogsMad)).toBeCloseTo(600, 2); // 2 × 300
      expect(Number(rowAfterPriceChange?.profitMad)).toBeCloseTo(100, 2); // 700 - 600
    } finally {
      await sql`update public.products set purchase_price = 100.00 where id = ${productId}`;
      await sql`delete from public.orders where id = ${legacyOrder.id}`;
    }
  });
});
