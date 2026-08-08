import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";
import {
  getProfitSummary,
  getDeliveredOrdersProfitBreakdown,
  getBestSellingProducts,
} from "@/lib/queries/adminReports";

// اختبار تكامل حقيقي (نفس نمط باقي ملفات الاختبار) — منتج بثمن شراء/بيع
// معروفين بالضبط: شراء 100.00، بيع 350.00 → ربح 250.00 لكل قطعة.
const TEST_PHONE = "0655" + Math.floor(Math.random() * 100000).toString().padStart(6, "0");

let fixtureProductId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-REPORTS', 'test-fixture-reports', ${category.id},
      'منتج اختبار التقارير', 'قطعة', 1, 1, 100.00, 350.00, 200, 'published'
    )
    on conflict (sku) do update set purchase_price = 100.00, sale_price = 350.00, stock_quantity = 200
    returning id
  `;
  fixtureProductId = product.id;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone = ${TEST_PHONE}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-REPORTS'`;
});

async function makeDeliveredOrder(quantity: number): Promise<{ orderId: number }> {
  const result = await createOrder({
    items: [{ productId: fixtureProductId, variantId: null, quantity }],
    customer: {
      fullName: "زبون اختبار التقارير",
      phone: TEST_PHONE,
      city: "الرباط",
      address: "عنوان اختبار",
      notes: null,
    },
    idempotencyKey: randomUUID(),
  });
  if (!result.ok) throw new Error("order failed: " + JSON.stringify(result.errors));

  const [row] = await sql<{ id: number }[]>`
    select id from public.orders where public_reference = ${result.publicReference}
  `;
  await sql`update public.orders set status = 'delivered' where id = ${row.id}`;

  return { orderId: row.id };
}

describe("getDeliveredOrdersProfitBreakdown — الربح لكل طلب مسلَّم", () => {
  test("الربح = المبيعات - (الكمية × ثمن الشراء الحالي)، بالضبط", async () => {
    const { orderId } = await makeDeliveredOrder(4); // 4 × 350 = 1400 مبيعات، 4 × 100 = 400 تكلفة، 1000 ربح

    const breakdown = await getDeliveredOrdersProfitBreakdown(50);
    const row = breakdown.find((r) => r.orderId === orderId);

    expect(row).toBeDefined();
    expect(Number(row?.revenueMad)).toBeCloseTo(1400, 2);
    expect(Number(row?.cogsMad)).toBeCloseTo(400, 2);
    expect(Number(row?.profitMad)).toBeCloseTo(1000, 2);
  });
});

describe("getProfitSummary — لا يشمل الملغى ولا الراجع", () => {
  test("طلب مسلَّم يزيد deliveredRevenue وgrossProfit بالضبط، وcancelled/returned لا يدخلان", async () => {
    const before = await getProfitSummary();

    await makeDeliveredOrder(3); // 3 × 350 = 1050 مبيعات (فوق الحد الأدنى 1000)، 3 × 100 = 300 تكلفة، 750 ربح

    const after = await getProfitSummary();

    expect(after.deliveredOrdersCount).toBe(before.deliveredOrdersCount + 1);
    expect(Number(after.deliveredRevenueMad) - Number(before.deliveredRevenueMad)).toBeCloseTo(1050, 2);
    expect(Number(after.cogsMad) - Number(before.cogsMad)).toBeCloseTo(300, 2);
    expect(Number(after.grossProfitMad) - Number(before.grossProfitMad)).toBeCloseTo(750, 2);
  });

  test("طلب راجع (returned) لا يُحتسَب فـdeliveredRevenue ولا الربح", async () => {
    const { orderId } = await makeDeliveredOrder(3);
    const before = await getProfitSummary();

    await sql`update public.orders set status = 'returned' where id = ${orderId}`;

    const after = await getProfitSummary();

    expect(after.deliveredOrdersCount).toBe(before.deliveredOrdersCount - 1);
    expect(Number(before.deliveredRevenueMad) - Number(after.deliveredRevenueMad)).toBeCloseTo(1050, 2);
    expect(after.returnedOrdersCount).toBe(before.returnedOrdersCount + 1);
  });
});

describe("getBestSellingProducts — الأكثر مبيعاً من الطلبات المسلَّمة فقط", () => {
  test("يظهر منتج الاختبار بالكمية والقيمة الصحيحتين ضمن النتائج", async () => {
    await makeDeliveredOrder(5); // 5 × 350 = 1750

    const byQuantity = await getBestSellingProducts("quantity", 1000);
    const bySkuQty = byQuantity.find((p) => p.sku === "TEST-FIXTURE-REPORTS");
    expect(bySkuQty).toBeDefined();
    expect(bySkuQty?.totalQuantity).toBeGreaterThanOrEqual(5);

    const byValue = await getBestSellingProducts("value", 1000);
    const bySkuValue = byValue.find((p) => p.sku === "TEST-FIXTURE-REPORTS");
    expect(bySkuValue).toBeDefined();
    expect(Number(bySkuValue?.totalValueMad)).toBeGreaterThanOrEqual(1750);
  });
});
