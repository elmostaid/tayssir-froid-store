import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";

// Meta مُلفَّق: نعدّ كم مرة تُرسَل البيعة فعلاً. الإرسال مفعَّل للطلبات
// اليدوية في هذا الملف (كما في الإنتاج)، فالعدّ يقيس السلوك الحقيقي.
const sendCapiEventMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true })));
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));
vi.mock("@/lib/ga/measurementProtocol", () => ({
  sendGaPurchaseEvent: vi.fn(async () => false),
  isGaMeasurementProtocolConfigured: () => false,
}));
process.env.META_OFFLINE_PURCHASES_ENABLED = "true";
process.env.META_OFFLINE_PURCHASES_SINCE = "2026-01-01T00:00:00Z";
process.env.META_PURCHASE_LEGITIMATE_INTEREST_SINCE = "2026-01-01T00:00:00Z";

const { createManualOrder, manualIdempotencyKey } = await import("@/lib/orders/createManualOrder");

const PHONE = "0655000777";
const SKU = "MAN-IDEM-001";

const stock = async () =>
  (await sql<{ stock_quantity: number }[]>`select stock_quantity from public.products where sku = ${SKU}`)[0]
    .stock_quantity;
const ordersForPhone = async () =>
  (await sql<{ n: number }[]>`select count(*)::int as n from public.orders where customer_phone = ${PHONE}`)[0].n;
const movementsFor = async (orderId: number) =>
  (await sql<{ n: number }[]>`select count(*)::int as n from public.stock_movements where order_id = ${orderId}`)[0].n;

let productId = 0;

function input(key: string | null, quantity = 3) {
  return {
    customer: { fullName: "زبون اختبار التكرار", phone: PHONE, city: "فاس", address: "حي اختبار", notes: null },
    source: "whatsapp" as const,
    items: [{ productId, variantId: null, quantity, unitPriceOverride: null }],
    deliveryFee: 20,
    createdByEmail: "admin@local",
    idempotencyKey: key,
  };
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  await sql`delete from public.orders where customer_phone = ${PHONE}`;
  await sql`delete from public.products where sku = ${SKU}`;
  const [row] = await sql<{ id: number }[]>`
    insert into public.products (sku, slug, category_id, name_ar, unit_label, min_order_qty, qty_increment,
      purchase_price, sale_price, stock_quantity, status)
    values (${SKU}, 'man-idem-001', ${category.id}, 'قطعة اختبار التكرار', 'قطعة', 1, 1, 10, 25, 10, 'published')
    returning id`;
  productId = row.id;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone = ${PHONE}`;
  await sql`delete from public.products where sku = ${SKU}`;
});

describe("مفتاح منع التكرار للطلب اليدوي", () => {
  test("المفتاح يُطبَّع في فضاء أسماء منفصل، والمشوَّه يُتجاهَل", () => {
    const key = randomUUID();
    expect(manualIdempotencyKey(key)).toBe(`manual:${key}`);
    expect(manualIdempotencyKey("")).toBeNull();
    expect(manualIdempotencyKey("short")).toBeNull();
    expect(manualIdempotencyKey("'; drop table orders; --x")).toBeNull();
    expect(manualIdempotencyKey(null)).toBeNull();
  });

  test("إرسال نفس المحاولة مرّتين ⇒ طلبية واحدة، ومخزون يُخصم مرّة واحدة", async () => {
    const key = randomUUID();
    const before = await stock();
    const ordersBefore = await ordersForPhone();

    const first = await createManualOrder(input(key));
    const second = await createManualOrder(input(key));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.orderId).toBe(first.orderId);
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(first.duplicate).toBeFalsy();
    expect(second.duplicate).toBe(true);
    expect(await ordersForPhone()).toBe(ordersBefore + 1);
    expect(await stock()).toBe(before - 3);
    expect(await movementsFor(first.orderId)).toBe(1);
  });

  test("حُفظت ثم ضاع الجواب، والمخزون نفد بعدها ⇒ إعادة الإرسال تُرجع الطلبية لا خطأ مخزون", async () => {
    const key = randomUUID();
    const available = await stock();
    // الطلبية الأولى تأخذ كل المخزون — كأن المدير لم يرَ جوابها.
    const first = await createManualOrder(input(key, available));
    expect(first.ok).toBe(true);
    expect(await stock()).toBe(0);

    const retry = await createManualOrder(input(key, available));
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    if (first.ok && retry.ok) expect(retry.orderId).toBe(first.orderId);
    expect(await stock()).toBe(0);

    await sql`update public.products set stock_quantity = 10 where sku = ${SKU}`;
  });

  test("إرسالان متزامنان بنفس المفتاح ⇒ طلبية واحدة (القيد الفريد في القاعدة يحسم)", async () => {
    const key = randomUUID();
    const before = await stock();
    const ordersBefore = await ordersForPhone();

    const results = await Promise.all([createManualOrder(input(key, 2)), createManualOrder(input(key, 2))]);
    const ids = results.map((r) => (r.ok ? r.orderId : null));
    expect(ids[0]).not.toBeNull();
    expect(ids[0]).toBe(ids[1]);
    expect(results.filter((r) => r.ok && r.duplicate).length).toBe(1);
    expect(await ordersForPhone()).toBe(ordersBefore + 1);
    expect(await stock()).toBe(before - 2);
  });

  test("القيد على مستوى القاعدة نفسها: إدراج ثانٍ بنفس المفتاح مرفوض", async () => {
    const key = manualIdempotencyKey(randomUUID())!;
    const first = await createManualOrder(input(key.slice("manual:".length), 1));
    expect(first.ok).toBe(true);
    await expect(
      sql`insert into public.orders (customer_name, customer_phone, customer_city, items_subtotal,
            final_total, status, source, idempotency_key)
          values ('x', ${PHONE}, 'x', 1, 1, 'confirmed', 'whatsapp', ${key})`
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("محاولتان مختلفتان (مفتاحان) ⇒ طلبيتان — لا يُدمج بيعان حقيقيان", async () => {
    const ordersBefore = await ordersForPhone();
    const a = await createManualOrder(input(randomUUID(), 1));
    const b = await createManualOrder(input(randomUUID(), 1));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.orderId).not.toBe(b.orderId);
    expect(await ordersForPhone()).toBe(ordersBefore + 2);
  });

  test("بلا مفتاح (تحويل طلب واتساب، مسار قديم) ⇒ السلوك كما كان تماماً", async () => {
    const ordersBefore = await ordersForPhone();
    const a = await createManualOrder(input(null, 1));
    const b = await createManualOrder(input(null, 1));
    expect(a.ok && b.ok).toBe(true);
    expect(await ordersForPhone()).toBe(ordersBefore + 2);
    if (a.ok) {
      const [row] = await sql<{ idempotency_key: string | null; status: string; source: string }[]>`
        select idempotency_key, status, source from public.orders where id = ${a.orderId}`;
      expect(row).toEqual({ idempotency_key: null, status: "confirmed", source: "whatsapp" });
    }
  });

  test("الطلبية المحمية تبقى كما كانت: مؤكَّدة، نفس المجاميع، ونفس سجلّ الحالة", async () => {
    const key = randomUUID();
    const first = await createManualOrder(input(key, 2));
    await createManualOrder(input(key, 2));
    if (!first.ok) throw new Error("expected ok");
    const [row] = await sql<{ status: string; items_subtotal: string; final_total: string; confirmed: boolean }[]>`
      select status, items_subtotal::text, final_total::text, confirmed_at is not null as confirmed
      from public.orders where id = ${first.orderId}`;
    expect(row).toEqual({ status: "confirmed", items_subtotal: "50.00", final_total: "70.00", confirmed: true });
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.order_status_history where order_id = ${first.orderId}`;
    expect(n).toBe(1);
  });

  test("Purchase يُرسَل مرّة واحدة بالضبط مهما أُعيد الإرسال", async () => {
    await sql`update public.products set stock_quantity = 10 where sku = ${SKU}`;
    const key = randomUUID();
    sendCapiEventMock.mockClear();
    const first = await createManualOrder(input(key, 1));
    await createManualOrder(input(key, 1));
    await createManualOrder(input(key, 1));
    if (!first.ok) throw new Error("expected ok");
    const purchases = sendCapiEventMock.mock.calls.filter(
      (call) => (call[0] as { eventName?: string } | undefined)?.eventName === "Purchase"
    );
    expect(purchases).toHaveLength(1);
    const [row] = await sql<{ sent: boolean; attempts: number }[]>`
      select meta_purchase_sent_at is not null as sent, meta_purchase_attempts as attempts
      from public.orders where id = ${first.orderId}`;
    expect(row).toEqual({ sent: true, attempts: 1 });
  });

  test("حُفظت والجواب ضاع قبل إرسال البيعة ⇒ إعادة الإرسال تُرسلها مرّة واحدة، لا صفراً ولا مرّتين", async () => {
    await sql`update public.products set stock_quantity = 10 where sku = ${SKU}`;
    const key = randomUUID();
    sendCapiEventMock.mockClear();
    // المحاولة الأولى كما وقعت في الانقطاع: الطلبية مُلتزَمة، ولم تبلغ مرحلة
    // إرسال البيعة. نحاكي «لم يُرسَل شيء» بإطفاء الإرسال لحظتها فقط.
    process.env.META_OFFLINE_PURCHASES_ENABLED = "false";
    const first = await createManualOrder(input(key, 1));
    process.env.META_OFFLINE_PURCHASES_ENABLED = "true";
    if (!first.ok) throw new Error("expected ok");
    expect(sendCapiEventMock).toHaveBeenCalledTimes(0);

    const retry = await createManualOrder(input(key, 1));
    expect(retry).toMatchObject({ ok: true, duplicate: true, orderId: first.orderId });
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);

    await createManualOrder(input(key, 1));
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
    const [row] = await sql<{ sent: boolean; attempts: number }[]>`
      select meta_purchase_sent_at is not null as sent, meta_purchase_attempts as attempts
      from public.orders where id = ${first.orderId}`;
    expect(row).toEqual({ sent: true, attempts: 1 });
  });
});
