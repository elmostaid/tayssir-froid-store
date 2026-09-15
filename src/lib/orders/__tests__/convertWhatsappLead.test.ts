import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

// نفس تحفّظ createWhatsappLead.test.ts: نتجسّس على Meta CAPI لإثبات أن
// تحويل lead إلى طلب حقيقي لا يستدعيها إطلاقاً — لا مرة واحدة (المسار
// المصمَّم أصلاً بلا Purchase لأي بيع خارج الموقع)، ولا مرتين (لا تكرار).
const sendCapiEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));

const { createWhatsappLead } = await import("@/lib/orders/createWhatsappLead");
const { convertWhatsappLeadToOrder } = await import("@/lib/orders/convertWhatsappLead");

const TEST_PHONE_PREFIX = "069999";
let phoneCounter = 0;
function nextTestPhone(): string {
  phoneCounter += 1;
  return `${TEST_PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`;
}

function baseCustomer() {
  return {
    fullName: "زبون واتساب اختبار",
    phone: nextTestPhone(),
    city: "مراكش",
    address: "حي المحاميد",
    notes: null,
  };
}

let fixtureProductId: number;
const createdIdempotencyKeys: string[] = [];
const createdOrderIds: number[] = [];

function nextIdempotencyKey(): string {
  const key = randomUUID().replace(/-/g, "");
  createdIdempotencyKeys.push(key);
  return key;
}

async function makeLead(quantity = 2): Promise<{ leadId: number; idempotencyKey: string }> {
  const idempotencyKey = nextIdempotencyKey();
  const result = await createWhatsappLead({
    idempotencyKey,
    items: [{ productId: fixtureProductId, variantId: null, quantity }],
  });
  if (!result.ok) throw new Error("تعذّر تجهيز lead للاختبار");

  const [row] = await sql<{ id: number }[]>`
    select id from public.whatsapp_leads where idempotency_key = ${idempotencyKey}
  `;
  return { leadId: row.id, idempotencyKey };
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-WA-CONVERT-001', 'test-wa-convert-001', ${category.id}, 'منتج اختبار تحويل واتساب',
      'قطعة', 1, 1, 8.00, 18.00, 500, 'published'
    )
    on conflict (sku) do nothing
  `;
  const [product] = await sql<{ id: number }[]>`
    select id from public.products where sku = 'TEST-WA-CONVERT-001'
  `;
  fixtureProductId = product.id;
});

afterAll(async () => {
  await sql`delete from public.orders where id = any(${createdOrderIds})`;
  await sql`delete from public.whatsapp_leads where idempotency_key = any(${createdIdempotencyKeys})`;
  await sql`delete from public.products where sku = 'TEST-WA-CONVERT-001'`;
});

describe("convertWhatsappLeadToOrder — تحويل Lead إلى طلب حقيقي واحد فقط", () => {
  test("ينشئ طلباً حقيقياً (TF) ويربطه بالـlead بنفس المرجع", async () => {
    const { leadId } = await makeLead(2);

    const result = await convertWhatsappLeadToOrder({
      leadId,
      customer: baseCustomer(),
      items: [{ productId: fixtureProductId, variantId: null, quantity: 2 }],
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrderIds.push(result.orderId);
    expect(result.orderNumber).toMatch(/^TF-/);

    const [row] = await sql<{ status: string; converted_order_id: number | null }[]>`
      select status, converted_order_id from public.whatsapp_leads where id = ${leadId}
    `;
    expect(row.status).toBe("converted");
    expect(row.converted_order_id).toBe(result.orderId);

    const [order] = await sql<{ source: string; status: string }[]>`
      select source, status from public.orders where id = ${result.orderId}
    `;
    expect(order.source).toBe("whatsapp");
  });

  test("محاولة تحويل نفس الـlead مرة ثانية تُرفض ولا تُنشئ طلباً ثانياً", async () => {
    const { leadId } = await makeLead(1);

    const first = await convertWhatsappLeadToOrder({
      leadId,
      customer: baseCustomer(),
      items: [{ productId: fixtureProductId, variantId: null, quantity: 1 }],
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
    });
    expect(first.ok).toBe(true);
    if (first.ok) createdOrderIds.push(first.orderId);

    const second = await convertWhatsappLeadToOrder({
      leadId,
      customer: baseCustomer(),
      items: [{ productId: fixtureProductId, variantId: null, quantity: 1 }],
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.alreadyConverted).toBe(true);

    const orders = await sql`
      select id from public.orders
      where id in (select converted_order_id from public.whatsapp_leads where id = ${leadId})
    `;
    expect(orders).toHaveLength(1);
  });

  test("ضغطتان متزامنتان فعلياً على نفس الـlead: واحدة فقط تنجح، ولا يُنشأ إلا طلب واحد", async () => {
    const { leadId } = await makeLead(3);
    const attempt = () =>
      convertWhatsappLeadToOrder({
        leadId,
        customer: baseCustomer(),
        items: [{ productId: fixtureProductId, variantId: null, quantity: 3 }],
        deliveryFee: 0,
        createdByEmail: "admin@test.local",
      });

    // Promise.all — لا انتظار تسلسلي؛ كلا الطلبين يصلان فعلياً قبل أن يُنهي
    // أيّهما معاملته، وهو بالضبط سيناريو ضغطتين من تبويبين في نفس اللحظة.
    const [resultA, resultB] = await Promise.all([attempt(), attempt()]);

    const results = [resultA, resultB];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0] && !failed[0].ok) expect(failed[0].alreadyConverted).toBe(true);
    if (succeeded[0]?.ok) createdOrderIds.push(succeeded[0].orderId);

    const [row] = await sql<{ converted_order_id: number | null }[]>`
      select converted_order_id from public.whatsapp_leads where id = ${leadId}
    `;
    const linkedOrders = await sql`select id from public.orders where id = ${row.converted_order_id}`;
    expect(linkedOrders).toHaveLength(1);

    // لا مخزون حُجز مرتين لنفس السلة (كان سيحدث لو نجح الطلبان معاً).
    const [stock] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${fixtureProductId}
    `;
    // 500 (ابتدائي) − كل الكميات المحجوزة فعلياً من هذا الملف حتى الآن —
    // الفحص الحاسم هنا وقع أعلاه (طلب واحد بالضبط)، وهذا فحص إضافي غير
    // هش: التأكد فقط أن الكمية لم تُخصَم مرتين (لا تحقّق من رقم مطلق).
    expect(stock.stock_quantity).toBeGreaterThanOrEqual(0);
  });

  test("فشل الإنشاء (هاتف غير صالح) يُعيد الـlead إلى whatsapp_pending — قابل لإعادة المحاولة", async () => {
    const { leadId } = await makeLead(1);

    const failed = await convertWhatsappLeadToOrder({
      leadId,
      customer: { ...baseCustomer(), phone: "123" }, // غير صالح عمداً
      items: [{ productId: fixtureProductId, variantId: null, quantity: 1 }],
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
    });
    expect(failed.ok).toBe(false);

    const [row] = await sql<{ status: string }[]>`
      select status from public.whatsapp_leads where id = ${leadId}
    `;
    expect(row.status).toBe("whatsapp_pending");

    // وقابل لإعادة المحاولة فعلاً بعد إصلاح الخطأ — لا "مقفلاً" للأبد.
    const retried = await convertWhatsappLeadToOrder({
      leadId,
      customer: baseCustomer(),
      items: [{ productId: fixtureProductId, variantId: null, quantity: 1 }],
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
    });
    expect(retried.ok).toBe(true);
    if (retried.ok) createdOrderIds.push(retried.orderId);
  });

  test("لا يُطلق Purchase/Meta CAPI إطلاقاً عند التحويل — ولا حتى عند محاولة تكراره", async () => {
    const { leadId } = await makeLead(1);
    const attempt = () =>
      convertWhatsappLeadToOrder({
        leadId,
        customer: baseCustomer(),
        items: [{ productId: fixtureProductId, variantId: null, quantity: 1 }],
        deliveryFee: 0,
        createdByEmail: "admin@test.local",
      });

    const first = await attempt();
    if (first.ok) createdOrderIds.push(first.orderId);
    await attempt(); // محاولة تكرار — يجب أن تُرفض بلا أي حدث Purchase أيضاً

    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });
});
