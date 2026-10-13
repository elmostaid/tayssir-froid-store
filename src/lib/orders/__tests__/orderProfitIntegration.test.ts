import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { getAdminOrderItems, getAdminOrderById } from "@/lib/queries/adminOrders";
import { computeOrderProfit } from "@/lib/orders/orderProfit";

/** اختبار تكامل على Postgres محلي: الحساب كما سيقرؤه الخادم فعلاً. */
describe("ربح الطلبية — تكامل مع القاعدة", () => {
  let orderId = 0;

  beforeAll(async () => {
    const [c] = await sql<{ id: number }[]>`
      insert into public.categories (name_ar, slug, is_active)
      values ('تصنيف اختبار ربح', 'profit-probe-cat', true)
      on conflict (slug) do update set is_active = true returning id`;
    const [p] = await sql<{ id: number }[]>`
      insert into public.products (category_id, name_ar, slug, sku, sale_price, purchase_price, stock_quantity, status)
      values (${c.id}, 'قطعة اختبار ربح', 'profit-probe', 'TF-PROFIT-1', 100, 60, 50, 'published')
      on conflict (sku) do update set purchase_price = 60 returning id`;
    const [o] = await sql<{ id: number }[]>`
      insert into public.orders (customer_name, customer_phone, customer_city, customer_address,
        items_subtotal, delivery_fee, final_total, status, source)
      values ('زبون اختبار', '0600000000', 'الدار البيضاء', 'عنوان', 300, 35, 335, 'confirmed', 'website')
      returning id`;
    orderId = o.id;
    await sql`insert into public.order_items (order_id, product_id, product_name_snapshot, sku_snapshot,
        unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status)
      values (${orderId}, ${p.id}, 'قطعة اختبار ربح', 'TF-PROFIT-1', 100, 3, 300, 60, 'reserved')`;
  });

  // الاختبار لا يترك أثراً: الطلب وسطوره يُحذفان، والمنتج معهما.
  afterAll(async () => {
    if (orderId) await sql`delete from public.orders where id = ${orderId}`;
    await sql`delete from public.products where sku = 'TF-PROFIT-1'`;
    await sql`delete from public.categories where slug = 'profit-probe-cat'`;
  });

  it("يقرأ snapshot من القاعدة ويحسب الربح", async () => {
    const order = await getAdminOrderById(orderId);
    const items = await getAdminOrderItems(orderId);
    expect(items[0].purchasePriceSnapshot).toBe("60.00");
    const p = computeOrderProfit({
      status: order!.status,
      lines: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPriceSnapshot,
        purchasePriceSnapshot: i.purchasePriceSnapshot, currentPurchasePrice: i.currentPurchasePrice,
        lineStatus: i.lineStatus })),
      deliveryFee: order!.deliveryFee, actualDeliveryCost: order!.actualDeliveryCost,
    });
    expect(p.salesMad).toBe(300);
    expect(p.cogsMad).toBe(180);
    expect(p.grossProfitMad).toBe(120);
    expect(p.realization).toBe("expected");
  });

  it("تغيير ثمن الشراء فالكتالوغ لا يمسّ ربح الطلبية", async () => {
    await sql`update public.products set purchase_price = 95 where sku = 'TF-PROFIT-1'`;
    const items = await getAdminOrderItems(orderId);
    expect(items[0].purchasePriceSnapshot).toBe("60.00");   // ثابت
    expect(items[0].currentPurchasePrice).toBe("95.00");    // تغيّر فالكتالوغ
    const p = computeOrderProfit({ status: "delivered",
      lines: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPriceSnapshot,
        purchasePriceSnapshot: i.purchasePriceSnapshot, currentPurchasePrice: i.currentPurchasePrice,
        lineStatus: i.lineStatus })), deliveryFee: "35", actualDeliveryCost: null });
    expect(p.cogsMad).toBe(180);        // لا 285
    expect(p.grossProfitMad).toBe(120); // الربح التاريخي سليم
  });

  it("تعديل الكمية ينعكس فوراً بلا أي كتابة إضافية", async () => {
    await sql`update public.order_items set quantity = 5, line_total = 500 where order_id = ${orderId}`;
    const items = await getAdminOrderItems(orderId);
    const p = computeOrderProfit({ status: "confirmed",
      lines: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPriceSnapshot,
        purchasePriceSnapshot: i.purchasePriceSnapshot, currentPurchasePrice: i.currentPurchasePrice,
        lineStatus: i.lineStatus })), deliveryFee: "35", actualDeliveryCost: "40" });
    expect(p.salesMad).toBe(500);
    expect(p.cogsMad).toBe(300);
    expect(p.grossProfitMad).toBe(200);
    expect(p.netProfitMad).toBe(195); // 200 + (35 − 40)
  });

  it("الإلغاء لا يُصفّر الربح ولا يمسّ line_status", async () => {
    await sql`update public.orders set status = 'cancelled' where id = ${orderId}`;
    const items = await getAdminOrderItems(orderId);
    expect(items.every((i) => i.lineStatus === "reserved")).toBe(true);
    const p = computeOrderProfit({ status: "cancelled",
      lines: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPriceSnapshot,
        purchasePriceSnapshot: i.purchasePriceSnapshot, currentPurchasePrice: i.currentPurchasePrice,
        lineStatus: i.lineStatus })), deliveryFee: "35", actualDeliveryCost: "40" });
    expect(p.realization).toBe("not_a_sale");
    expect(p.grossProfitMad).toBe(200);  // باقٍ كما هو، لا صفر ولا null
  });
});
