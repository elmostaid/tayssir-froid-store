import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { createManualOrder } from "@/lib/orders/createManualOrder";
import { newIdempotencyKey } from "@/lib/orders/manualOrderKey";

/**
 * اختبارات تكامل حقيقية على قاعدة Postgres محلية — لا محاكاة.
 *
 * المقصود هنا لا يمكن أن يُحاكى: `on conflict (idempotency_key) do nothing`
 * حرسٌ تُنفّذه **القاعدة** ذرّياً، وثلاثة نداءات متزامنة تتسابق على فهرس
 * فريد حقيقي. أي mock كان سيختبر افتراضي عن Postgres لا سلوك Postgres.
 *
 * كل شيء معزول بهاتف فريد لكل ملف، ويُنظَّف بعد كل اختبار. لا علاقة لهذا
 * بقاعدة الإنتاج إطلاقاً.
 */

const PHONE = "0600000911";
let productId = 0;
let startingStock = 0;

const input = (key: string | null, quantity = 2, unitPrice = 500) => ({
  customer: {
    fullName: "اختبار تفرّد الطلبية",
    phone: PHONE,
    city: "الدار البيضاء",
    address: "عنوان اختبار",
    notes: null,
  },
  source: "phone" as const,
  items: [{ productId, variantId: null, quantity, unitPrice }],
  deliveryFee: 35,
  actualDeliveryCost: null,
  createdByEmail: "test@local",
  acknowledgeBelowCost: true,
  idempotencyKey: key,
});

async function stockNow(): Promise<number> {
  const [row] = await sql<{ stock_quantity: number }[]>`
    select stock_quantity from public.products where id = ${productId}`;
  return Number(row.stock_quantity);
}

async function ordersForPhone() {
  return sql<{ id: number; order_number: string; idempotency_key: string | null }[]>`
    select id, order_number, idempotency_key from public.orders
    where customer_phone = ${PHONE} order by id`;
}

async function cleanup() {
  await sql`delete from public.order_items where order_id in (
              select id from public.orders where customer_phone = ${PHONE})`;
  await sql`delete from public.order_status_history where order_id in (
              select id from public.orders where customer_phone = ${PHONE})`;
  await sql`delete from public.stock_movements where order_id in (
              select id from public.orders where customer_phone = ${PHONE})`;
  await sql`delete from public.orders where customer_phone = ${PHONE}`;
  if (productId) {
    await sql`update public.products set stock_quantity = ${startingStock} where id = ${productId}`;
  }
}

beforeAll(async () => {
  const [p] = await sql<{ id: number; stock_quantity: number }[]>`
    select id, stock_quantity from public.products
    where status = 'published' and stock_quantity >= 50 order by id limit 1`;
  productId = p.id;
  startingStock = Number(p.stock_quantity);
  await cleanup();
});

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
});

describe("مفتاح تفرّد الطلبية اليدوية", () => {
  test("نداء واحد: طلبية واحدة وخصم واحد", async () => {
    const before = await stockNow();
    const r = await createManualOrder(input(newIdempotencyKey()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replayed).toBe(false);
    expect(await stockNow()).toBe(before - 2);
    expect((await ordersForPhone()).length).toBe(1);
  });

  test("🔴 العطل المُصلَح: نداءان متطابقان بنفس المفتاح = طلبية واحدة وخصم واحد", async () => {
    const key = newIdempotencyKey();
    const before = await stockNow();

    const first = await createManualOrder(input(key));
    const second = await createManualOrder(input(key));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(second.orderNumber).toBe(first.orderNumber);

    expect(await stockNow()).toBe(before - 2); // لا −4
    expect((await ordersForPhone()).length).toBe(1);
  });

  test("ثلاثة نداءات **متزامنة** بنفس المفتاح = طلبية واحدة وخصم واحد", async () => {
    const key = newIdempotencyKey();
    const before = await stockNow();

    const results = await Promise.all([
      createManualOrder(input(key)),
      createManualOrder(input(key)),
      createManualOrder(input(key)),
    ]);

    const ok = results.filter((r) => r.ok);
    expect(ok.length).toBe(3); // لا واحد يفشل: الثلاثة ترى طلبية صالحة
    const ids = new Set(ok.map((r) => (r.ok ? r.orderId : 0)));
    expect(ids.size).toBe(1); // ونفس الطلبية بالضبط

    const created = ok.filter((r) => r.ok && !r.replayed);
    expect(created.length).toBe(1); // واحد فقط أنشأ فعلاً

    expect(await stockNow()).toBe(before - 2);
    expect((await ordersForPhone()).length).toBe(1);
  });

  test("انقطاع بعد COMMIT: الطلبية محفوظة، وإعادة المحاولة لا تُنشئ ثانية", async () => {
    // هذا هو السيناريو المقصود حرفياً: المحاولة الأولى **نجحت في القاعدة**
    // ثم ضاع الإقرار، فالمدير لا يعرف النتيجة ويُعيد المحاولة بنفس المفتاح
    // المحفوظ في sessionStorage. نُحاكيه بإنشاء الطلبية ثم «نسيان» نتيجتها.
    const key = newIdempotencyKey();
    const before = await stockNow();

    const landed = await createManualOrder(input(key));
    expect(landed.ok).toBe(true);
    // ... انقطع الاتصال هنا؛ العميل لم يرَ هذه النتيجة إطلاقاً ...

    const retry = await createManualOrder(input(key));
    expect(retry.ok).toBe(true);
    if (!retry.ok || !landed.ok) return;
    expect(retry.replayed).toBe(true);
    expect(retry.orderId).toBe(landed.orderId);

    expect(await stockNow()).toBe(before - 2);
    expect((await ordersForPhone()).length).toBe(1);
  });

  test("نفس المفتاح بمحتوى مختلف لا يُعدّل الطلبية المنفَّذة", async () => {
    const key = newIdempotencyKey();
    const before = await stockNow();

    const first = await createManualOrder(input(key, 2, 500));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const [original] = await sql<{ items_subtotal: string; final_total: string }[]>`
      select items_subtotal, final_total from public.orders where id = ${first.orderId}`;

    // محاولة ثانية بكمية وثمن مختلفين تماماً.
    const tampered = await createManualOrder(input(key, 9, 999));
    expect(tampered.ok).toBe(true);
    if (!tampered.ok) return;
    expect(tampered.replayed).toBe(true);
    expect(tampered.orderId).toBe(first.orderId);

    const [after] = await sql<{ items_subtotal: string; final_total: string }[]>`
      select items_subtotal, final_total from public.orders where id = ${first.orderId}`;
    expect(after.items_subtotal).toBe(original.items_subtotal);
    expect(after.final_total).toBe(original.final_total);

    // ولا سطر إضافي ولا خصم إضافي.
    const [{ lines }] = await sql<{ lines: number }[]>`
      select count(*)::int as lines from public.order_items where order_id = ${first.orderId}`;
    expect(lines).toBe(1);
    expect(await stockNow()).toBe(before - 2);
  });

  test("مفتاحان مختلفان = طلبيتان — لا دمج زائف", async () => {
    const before = await stockNow();
    const a = await createManualOrder(input(newIdempotencyKey()));
    const b = await createManualOrder(input(newIdempotencyKey()));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.orderId).not.toBe(b.orderId);
    expect(await stockNow()).toBe(before - 4);
    expect((await ordersForPhone()).length).toBe(2);
  });

  test("مفتاح مشوَّه يُرفَض قبل أي كتابة", async () => {
    const before = await stockNow();
    const r = await createManualOrder(input("قصير"));
    expect(r.ok).toBe(false);
    expect(await stockNow()).toBe(before);
    expect((await ordersForPhone()).length).toBe(0);
  });

  test("بلا مفتاح: السلوك السابق كما هو (لا حرس) — موثَّق لا مُفترَض", async () => {
    const before = await stockNow();
    const a = await createManualOrder(input(null));
    const b = await createManualOrder(input(null));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // طلبيتان: هذا بالضبط العطل الذي يُغلقه المفتاح، ويبقى قائماً حين يغيب.
    expect(a.orderId).not.toBe(b.orderId);
    expect(await stockNow()).toBe(before - 4);
  });
});
