import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import type { AnalyticsSessionContext } from "@/lib/analytics/events";

/**
 * الشراء لا يعتمد على بقاء المتصفح.
 *
 * العطل الذي أوجب هذا الملف: `CheckoutClient` كان ينتظر تأكيد الحفظ 2.5
 * ثانية فقط، ثم ينتقل إلى واتساب. الأحداث الثلاثة (الداخلي، GA4، Pixel)
 * كانت كلها داخل `if (confirmed)` — فأي طلب يُحفظ بنجاح لكن أبطأ من المهلة
 * يصير طلباً حقيقياً بلا أي حدث شراء. وقع فعلاً لطلب TF-2026-0081.
 *
 * ما تختبره هذه الحالات هو الضمانة الجديدة: الطلب المحفوظ في القاعدة هو
 * مصدر الحقيقة، والخادم هو من يُسجّل الشراء — فلا فرق بين متصفح بقي مفتوحاً
 * وآخر أُغلق فوراً، لأن المتصفح لم يعد طرفاً في المعادلة أصلاً.
 */

const sendCapiEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));

// GA4 Measurement Protocol: نتحكّم في جوابه لنختبر الحالتين — أرسل الخادم
// (فيسكت المتصفح) أو لم يُرسل (فيبقى المتصفح مسؤولاً).
const sendGaPurchaseEventMock = vi.hoisted(() =>
  vi.fn(async (params: Record<string, unknown>) => Boolean(params))
);
vi.mock("@/lib/ga/measurementProtocol", () => ({
  sendGaPurchaseEvent: sendGaPurchaseEventMock,
  isGaMeasurementProtocolConfigured: () => true,
}));

const { createOrder } = await import("@/lib/orders/createOrder");

const PHONE_PREFIX = "061111";
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `${PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`;
}

function sessionContext(): AnalyticsSessionContext {
  return {
    landingPath: "/",
    referrerHost: "m.facebook.com",
    utmSource: "facebook",
    utmMedium: "paid",
    utmCampaign: "tf_sales_v2",
    utmContent: "reel_23aug",
    utmTerm: "120251060729320742",
    hasClickId: true,
    startedAt: Date.now() - 60_000,
  };
}

function baseInput(overrides: Partial<Parameters<typeof createOrder>[0]> = {}) {
  return {
    items: [{ productId: 0, variantId: null, quantity: 1 }],
    customer: {
      fullName: "زبون اختبار الشراء",
      phone: nextPhone(),
      city: "مراكش",
      address: "عنوان اختبار",
      notes: null,
    },
    idempotencyKey: randomUUID(),
    requestContext: {
      analyticsSessionId: randomUUID(),
      analyticsContext: sessionContext(),
      gaClientId: "1234567890.1700000000",
      gaSessionId: "1756000000",
    },
    ...overrides,
  } as Parameters<typeof createOrder>[0];
}

let inStockProductId = 0;
let outOfStockProductId = 0;

async function purchaseRowsFor(orderRef: string) {
  return sql<
    {
      order_id: number;
      order_value: string;
      quantity: number;
      utm_source: string | null;
      session_id: string;
    }[]
  >`
    select e.order_id, e.order_value, e.quantity, e.utm_source, e.session_id
    from public.analytics_events e
    join public.orders o on o.id = e.order_id
    where o.public_reference = ${orderRef} and e.event_name = 'purchase'
  `;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;

  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values
    (
      'TEST-DURABLE-OK', 'test-durable-ok', ${category.id}, 'منتج اختبار الشراء الدائم',
      'قطعة', 1, 1, 10.00, 40.00, 100000, 'published'
    ),
    (
      'TEST-DURABLE-LOW', 'test-durable-low', ${category.id}, 'منتج اختبار مخزون ناقص',
      'قطعة', 1, 1, 10.00, 25.00, 1, 'published'
    )
    on conflict (sku) do nothing
  `;

  const rows = await sql<{ id: number; sku: string }[]>`
    select id, sku from public.products where sku in ('TEST-DURABLE-OK', 'TEST-DURABLE-LOW')
  `;
  inStockProductId = rows.find((r) => r.sku === "TEST-DURABLE-OK")!.id;
  outOfStockProductId = rows.find((r) => r.sku === "TEST-DURABLE-LOW")!.id;
});

afterEach(() => {
  sendGaPurchaseEventMock.mockClear();
  sendGaPurchaseEventMock.mockImplementation(async () => true);
  sendCapiEventMock.mockClear();
});

afterAll(async () => {
  await sql`
    delete from public.products where sku in ('TEST-DURABLE-OK', 'TEST-DURABLE-LOW')
  `;
});

describe("الشراء يُسجَّل من الخادم، لا من المتصفح", () => {
  test("طلب ناجح: الحدث الداخلي مكتوب في القاعدة قبل أن يعرف المتصفح شيئاً", async () => {
    const input = baseInput();
    input.items = [{ productId: inStockProductId, variantId: null, quantity: 3 }];

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // الحدث موجود بمجرد عودة createOrder — أي أن إغلاق الصفحة أو التحويل
    // إلى واتساب بعد هذه اللحظة لا يمكن أن يمنعه، لأنه كُتب أصلاً.
    const rows = await purchaseRowsFor(result.publicReference);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].order_value)).toBe(120);
    expect(rows[0].quantity).toBe(3);
    // سياق الجلسة يُقرأ من الكوكي، فالشراء يبقى منسوباً لحملته.
    expect(rows[0].utm_source).toBe("facebook");
    expect(rows[0].session_id).toBe(input.requestContext!.analyticsSessionId);
  });

  test("إغلاق/تحويل فوري بعد النجاح لا يغيّر شيئاً: لا شيء في المسار ينتظر المتصفح", async () => {
    const input = baseInput();
    input.items = [{ productId: inStockProductId, variantId: null, quantity: 1 }];

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // لا نستدعي أي كود متصفح إطلاقاً بعد هذه النقطة — وهي محاكاة أمينة
    // لصفحة اختفت. الحدث يجب أن يكون موجوداً رغم ذلك.
    const rows = await purchaseRowsFor(result.publicReference);
    expect(rows).toHaveLength(1);
    expect(sendGaPurchaseEventMock).toHaveBeenCalledTimes(1);
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
  });

  test("إعادة الإرسال بنفس idempotencyKey: طلب واحد وحدث واحد", async () => {
    const input = baseInput();
    input.items = [{ productId: inStockProductId, variantId: null, quantity: 2 }];

    const first = await createOrder(input);
    // نفس الحمولة حرفياً — إعادة تحميل الصفحة أو ضغط الزر مرتين.
    const second = await createOrder(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.publicReference).toBe(first.publicReference);

    const rows = await purchaseRowsFor(first.publicReference);
    expect(rows).toHaveLength(1);
    // ولا إرسال ثانٍ إلى GA4 ولا إلى Meta.
    expect(sendGaPurchaseEventMock).toHaveBeenCalledTimes(1);
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
    // والأهم: جواب المحاولة الثانية لا يُوقظ المتصفح ليُرسل نسخة ثانية.
    // لو قرأت الراية `isNew` لقالت هنا "أرسِلْ أنت" عن طلب أرسله الخادم.
    expect(second.gaPurchaseHandledServerSide).toBe(true);
  });

  test("طلب ينتظر مراجعة مخزون: لا شراء إطلاقاً", async () => {
    const input = baseInput();
    input.items = [
      { productId: inStockProductId, variantId: null, quantity: 1 },
      { productId: outOfStockProductId, variantId: null, quantity: 5 },
    ];

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsReview).toBe(true);

    const rows = await purchaseRowsFor(result.publicReference);
    expect(rows).toHaveLength(0);
    expect(sendGaPurchaseEventMock).not.toHaveBeenCalled();
    expect(sendCapiEventMock).not.toHaveBeenCalled();
    // والمتصفح كذلك يُمنَع: الحارس عنده هو needsReview نفسه.
    expect(result.gaPurchaseHandledServerSide).toBe(false);
  });

  test("فشل شبكة نحو GA4: الطلب والحدث الداخلي سليمان — لا شيء يُسقطهما", async () => {
    sendGaPurchaseEventMock.mockImplementation(async () => {
      throw new Error("شبكة مقطوعة");
    });

    const input = baseInput();
    input.items = [{ productId: inStockProductId, variantId: null, quantity: 1 }];

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // انهيار GA4 لا يُسقط الطلب ولا الحدث الداخلي — وهو المرجع الذي تُكشف
    // به أي فجوة في GA4 لاحقاً بالمقارنة.
    const rows = await purchaseRowsFor(result.publicReference);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].order_value)).toBe(40);
  });

  test("نجاح GA4 من الخادم يُسكِت المتصفح — فلا شراء مضاعف في التقارير", async () => {
    const input = baseInput();
    input.items = [{ productId: inStockProductId, variantId: null, quantity: 1 }];

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gaPurchaseHandledServerSide).toBe(true);

    expect(sendGaPurchaseEventMock).toHaveBeenCalledTimes(1);
    expect(sendGaPurchaseEventMock.mock.calls[0]?.[0]).toMatchObject({
      transactionId: result.publicReference,
      value: 40,
      clientId: "1234567890.1700000000",
      sessionId: "1756000000",
    });
  });

  test("بلا كوكي جلسة: الطلب يمرّ، والحدث الداخلي وحده يُتخطّى بلا ضجيج", async () => {
    const input = baseInput();
    input.items = [{ productId: inStockProductId, variantId: null, quantity: 1 }];
    input.requestContext = { gaClientId: "1234567890.1700000000" };

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await purchaseRowsFor(result.publicReference);
    expect(rows).toHaveLength(0);
    // ومع ذلك يصل GA4 وMeta — لا يعتمدان على كوكي القياس الداخلي.
    expect(sendGaPurchaseEventMock).toHaveBeenCalledTimes(1);
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
  });
});

describe("القاعدة نفسها ترفض الشراء المكرّر", () => {
  test("محاولة كتابة حدث شراء ثانٍ لنفس الطلب تفشل بقيد فريد", async () => {
    const input = baseInput();
    input.items = [{ productId: inStockProductId, variantId: null, quantity: 1 }];

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await purchaseRowsFor(result.publicReference);
    expect(row).toBeDefined();

    // نُحاكي عودة المسار القديم من المتصفح: نفس الطلب، حدث شراء ثانٍ.
    await expect(
      sql`
        insert into public.analytics_events (session_id, event_name, order_id, order_value)
        values (${randomUUID()}, 'purchase', ${row.order_id}, 100)
      `
    ).rejects.toThrow(/analytics_events_one_purchase_per_order_idx|duplicate key/i);

    const after = await purchaseRowsFor(result.publicReference);
    expect(after).toHaveLength(1);
  });
});
