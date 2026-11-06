import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * مصفوفة القنوات بإعدادات الإنتاج المقترحة كاملة:
 * META_OFFLINE_PURCHASES_ENABLED + SINCE، META_PURCHASE_LEGITIMATE_INTEREST_SINCE،
 * و NEXT_PUBLIC_AD_TRACKING_OPT_OUT=on (الرفض متاح).
 *
 * لكل حالة: كم Purchase بالضبط، وبأي حقول. Meta مُحاكاة بالكامل.
 */

type CapiPayload = {
  eventName: string;
  eventId: string;
  eventTimeMs?: number;
  actionSource?: string;
  eventSourceUrl?: string;
  userData?: Record<string, unknown>;
  customData: Record<string, unknown>;
};

const sendCapiEventMock = vi.hoisted(() =>
  vi.fn(async (payload: unknown): Promise<{ ok: boolean; eventsReceived?: number; error?: string; status?: number }> => {
    void payload;
    return { ok: true, eventsReceived: 1, status: 200 };
  })
);
vi.mock("@/lib/pixel/capi", () => ({
  sendCapiEvent: sendCapiEventMock,
  isCapiConfigured: () => true,
  hashForCapi: (value: string) => `sha256(${value})`,
}));
vi.mock("@/lib/auth/requireAdmin", () => ({
  getAdminUser: vi.fn().mockResolvedValue({ id: "test-admin", email: "admin@local", role: "admin" }),
  isOwnerAdmin: () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const { createOrder } = await import("@/lib/orders/createOrder");
const { createManualOrder } = await import("@/lib/orders/createManualOrder");
const { createWhatsappInquiry } = await import("@/lib/orders/createWhatsappInquiry");
const { updateOrderStatus, retryDeferredPurchase } = await import("@/app/admin/(protected)/orders/actions");
const { sendDeferredPurchase, purchaseEventId } = await import("@/lib/pixel/sendDeferredPurchase");
const { withInquiryReference } = await import("@/lib/whatsappInquiry");

const PHONE_PREFIX = "064466";
let n = 0;
const nextPhone = () => `${PHONE_PREFIX}${String(++n).padStart(4, "0")}`;
const SKU = "ALLCH-001";
const PRICE = 45.5;
let productId: number;

const FBCLID = "IwZXh0bgNhZW0BMABkYWxsY2hhbm5lbHM";
const FBCLID_AT = Date.now() - 3_600_000;
const AD = "120252323370090742";
const AD_TOUCH = {
  utmSource: "fb", utmMedium: "paid", utmCampaign: "120252323359690742", utmContent: AD, utmTerm: "120252323362860742",
  fbclid: FBCLID, gclid: null, ttclid: null, landingPath: "/washing-machines", referrerHost: "m.facebook.com", at: FBCLID_AT,
};
const VISITOR = {
  clientIpAddress: "105.66.1.21",
  clientUserAgent: "Mozilla/5.0 (Linux; Android 14) FB_IAB",
  fbp: "fb.1.1790000000000.123456789",
  eventSourceUrl: "https://www.tayssirfroid.com/checkout",
  analyticsSessionId: randomUUID(),
};

const purchases = () =>
  sendCapiEventMock.mock.calls.map((c) => c[0] as CapiPayload).filter((p) => p.eventName === "Purchase");
const settle = () => new Promise((r) => setTimeout(r, 60));

function statusForm(orderId: number, status: string, reason?: string) {
  const fd = new FormData();
  fd.set("orderId", String(orderId));
  fd.set("status", status);
  fd.set("note", "");
  if (reason) fd.set("cancellationReason", reason);
  return fd;
}

async function websiteOrder(adConsent: "unknown" | "denied" = "unknown", quantity = 20) {
  const result = await createOrder({
    items: [{ productId, variantId: null, quantity }],
    customer: { fullName: "زبون موقع", phone: nextPhone(), city: "مكناس", address: "عنوان", notes: null },
    idempotencyKey: randomUUID(),
    attribution: { first: AD_TOUCH, last: AD_TOUCH },
    requestContext: { ...VISITOR, adConsent },
  });
  if (!result.ok) throw new Error("website order failed");
  const [row] = await sql<{ id: number }[]>`select id from public.orders where public_reference = ${result.publicReference}`;
  return row.id;
}

function manual(source: "whatsapp" | "store" | "phone" | "other", extra: Record<string, unknown> = {}) {
  return createManualOrder({
    customer: { fullName: "زبون يدوي", phone: nextPhone(), city: "فاس", address: "حي" },
    source,
    items: [{ productId, variantId: null, quantity: 10, unitPriceOverride: null }],
    deliveryFee: 35,
    createdByEmail: "admin@local",
    ...extra,
  } as Parameters<typeof createManualOrder>[0]);
}

async function row(orderId: number) {
  const [r] = await sql<{
    status: string; confirmed_at: Date | null; ad_consent: string; capi_identity: Record<string, unknown> | null;
    meta_purchase_sent_at: Date | null; meta_purchase_accepted_at: Date | null; meta_purchase_error: string | null;
    meta_purchase_attempts: number; meta_purchase_action_source: string | null;
  }[]>`select status, confirmed_at, ad_consent, capi_identity, meta_purchase_sent_at, meta_purchase_accepted_at,
         meta_purchase_error, meta_purchase_attempts, meta_purchase_action_source
       from public.orders where id = ${orderId}`;
  return r;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [p] = await sql<{ id: number }[]>`
    insert into public.products (sku, slug, category_id, name_ar, unit_label, min_order_qty, qty_increment,
      purchase_price, sale_price, stock_quantity, status)
    values (${SKU}, 'allch-001', ${category.id}, 'قطعة مصفوفة القنوات', 'قطعة', 1, 1, 30, ${PRICE}, 100000, 'published')
    on conflict (sku) do update set stock_quantity = 100000 returning id`;
  productId = p.id;
});
beforeEach(() => {
  sendCapiEventMock.mockClear();
  const since = new Date(Date.now() - 60_000).toISOString();
  vi.stubEnv("META_OFFLINE_PURCHASES_ENABLED", "true");
  vi.stubEnv("META_OFFLINE_PURCHASES_SINCE", since);
  vi.stubEnv("META_PURCHASE_LEGITIMATE_INTEREST_SINCE", since);
  vi.stubEnv("NEXT_PUBLIC_AD_TRACKING_OPT_OUT", "on");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await sql`delete from public.whatsapp_inquiries where product_sku = ${SKU}`;
  await sql`delete from public.orders where customer_phone like ${`${PHONE_PREFIX}%`}`;
  await sql`delete from public.products where sku = ${SKU}`;
});

describe("الموقع", () => {
  test("الإنشاء لا يرسل؛ التأكيد يرسل Purchase واحدة بالحقول المطلوبة وهوية المطابقة", async () => {
    const id = await websiteOrder();
    await settle();
    expect(purchases()).toHaveLength(0);

    await updateOrderStatus({ error: null }, statusForm(id, "confirmed"));
    await vi.waitFor(() => expect(purchases()).toHaveLength(1), { timeout: 2000 });
    const [p] = purchases();
    const r = await row(id);
    expect(p.eventName).toBe("Purchase");
    expect(p.eventId).toBe(purchaseEventId(id));
    expect(p.eventTimeMs).toBe(new Date(r.confirmed_at!).getTime());
    expect(p.customData).toMatchObject({ currency: "MAD", value: 20 * PRICE });
    expect(p.actionSource).toBe("website");
    expect(p.eventSourceUrl).toBe(VISITOR.eventSourceUrl);
    expect(p.userData).toMatchObject({
      externalId: expect.stringMatching(/^2126/), phone: expect.stringMatching(/^2126/), country: "ma",
      fbp: VISITOR.fbp, fbc: `fb.1.${FBCLID_AT}.${FBCLID}`, clientIpAddress: VISITOR.clientIpAddress,
    });
    expect(r.ad_consent).toBe("unknown"); // الاختيار الحقيقي لم يُزوَّر
    expect(r.meta_purchase_action_source).toBe("website");
  });

  test("رفض صريح: الطلبية تُسجَّل وتُؤكَّد، ولا Purchase ولا هوية", async () => {
    const id = await websiteOrder("denied");
    await updateOrderStatus({ error: null }, statusForm(id, "confirmed"));
    await settle();
    expect(purchases()).toHaveLength(0);
    expect((await row(id)).capi_identity).toBeNull();
  });

  test("طلبية جديدة غير مؤكَّدة، وطلبية أُلغيت قبل التأكيد: صفر", async () => {
    const fresh = await websiteOrder();
    const cancelled = await websiteOrder();
    await updateOrderStatus({ error: null }, statusForm(cancelled, "cancelled", "customer_cancelled"));
    await settle();
    expect(purchases()).toHaveLength(0);
    expect(await sendDeferredPurchase(fresh)).toEqual({ sent: false, reason: "not_a_sale" });
    expect(await sendDeferredPurchase(cancelled)).toEqual({ sent: false, reason: "not_a_sale" });
  });

  test("إعادة الفتح ثم إعادة التأكيد والشحن، واستدعاءان متوازيان: Purchase واحدة", async () => {
    const id = await websiteOrder();
    await Promise.all([
      updateOrderStatus({ error: null }, statusForm(id, "confirmed")),
      sendDeferredPurchase(id),
    ]);
    await updateOrderStatus({ error: null }, statusForm(id, "new"));
    await updateOrderStatus({ error: null }, statusForm(id, "confirmed"));
    await updateOrderStatus({ error: null }, statusForm(id, "shipped"));
    await Promise.all([sendDeferredPurchase(id), sendDeferredPurchase(id)]);
    await settle();
    expect(purchases()).toHaveLength(1);
    expect((await row(id)).meta_purchase_attempts).toBe(1);
  });
});

describe("واتساب واليدوي", () => {
  test("واتساب مربوط باستفسار الموقع (Q-): chat، القيمة بلا توصيل، وهوية الزائر الحقيقية", async () => {
    const inquiry = await createWhatsappInquiry({
      idempotencyKey: randomUUID(), kind: "product", productSku: SKU, pagePath: "/washing-machines",
      attribution: { first: AD_TOUCH, last: AD_TOUCH }, requestContext: { ...VISITOR, adConsent: "unknown" },
    });
    if (!inquiry.ok) throw new Error("inquiry failed");
    const result = await manual("whatsapp", { origin: { reference: withInquiryReference("سلام", inquiry.reference) } });
    if (!result.ok) throw new Error("manual failed");
    const ps = purchases();
    expect(ps).toHaveLength(1);
    expect(ps[0].actionSource).toBe("chat");
    expect(ps[0].customData.value).toBe(10 * PRICE); // التوصيل 35 خارج القيمة
    expect(ps[0].eventSourceUrl).toBeUndefined();
    // fbc من fbclid المحفوظ في إسناد الاستفسار؛ لا fbp/IP لأن قيد القاعدة لا يحفظ
    // هوية الاستفسار إلا بموافقة صريحة.
    expect(ps[0].userData).toMatchObject({ fbc: `fb.1.${FBCLID_AT}.${FBCLID}` });
    expect(ps[0].userData?.fbp).toBeUndefined();
  });

  test("واتساب مباشر بلا مرجع: chat بالهاتف وحده — لا fbc ولا fbp مُختلَقة", async () => {
    const result = await manual("whatsapp");
    if (!result.ok) throw new Error("manual failed");
    const [p] = purchases();
    expect(p.actionSource).toBe("chat");
    expect(p.userData?.fbc).toBeUndefined();
    expect(p.userData?.fbp).toBeUndefined();
    expect(p.userData?.phone).toMatch(/^2126/);
  });

  test.each([
    ["store", "physical_store"],
    ["phone", "phone_call"],
    ["other", "other"],
  ] as const)("يدوي %s ⇒ %s، لا website أبداً، مرة واحدة", async (source, expected) => {
    const result = await manual(source);
    if (!result.ok) throw new Error("manual failed");
    await updateOrderStatus({ error: null }, statusForm(result.orderId, "shipped"));
    await settle();
    const ps = purchases();
    expect(ps).toHaveLength(1);
    expect(ps[0].actionSource).toBe(expected);
    expect(ps[0].customData).toMatchObject({ currency: "MAD", value: 10 * PRICE });
  });
});

describe("فشل CAPI ثم إعادة المحاولة", () => {
  test("الفشل يُسجَّل ويُحرَّر؛ زرّ الإعادة يرسل بنفس event_id؛ قبول واحد ولا إرسال بعده", async () => {
    // يفشل أول Purchase فقط (OrderSubmitted عند الإنشاء ليس شراءً ويمرّ عادياً).
    let failedOnce = false;
    sendCapiEventMock.mockImplementation(async (payload: unknown) => {
      if ((payload as CapiPayload).eventName === "Purchase" && !failedOnce) {
        failedOnce = true;
        return { ok: false, status: 503, error: "HTTP 503 — test" };
      }
      return { ok: true, eventsReceived: 1, status: 200 };
    });
    const id = await websiteOrder();
    await updateOrderStatus({ error: null }, statusForm(id, "confirmed"));
    await vi.waitFor(async () => expect((await row(id)).meta_purchase_error ?? "").toContain("HTTP 503"), { timeout: 3000 });
    let r = await row(id);
    expect(r.meta_purchase_sent_at).toBeNull();
    expect(r.meta_purchase_accepted_at).toBeNull();

    expect(await retryDeferredPurchase(id)).toEqual({ error: null });
    r = await row(id);
    expect(r.meta_purchase_accepted_at).not.toBeNull();
    expect(r.meta_purchase_error).toBeNull();

    await updateOrderStatus({ error: null }, statusForm(id, "shipped"));
    expect(await retryDeferredPurchase(id)).toEqual({ error: null }); // already_sent ⇒ لا شيء
    await settle();
    const ps = purchases();
    expect(ps).toHaveLength(2); // المحاولة الفاشلة + الناجحة
    expect(new Set(ps.map((p) => p.eventId))).toEqual(new Set([purchaseEventId(id)]));
    sendCapiEventMock.mockReset();
    sendCapiEventMock.mockImplementation(async () => ({ ok: true, eventsReceived: 1, status: 200 }));
  });

  test("الإنشاء يرسل OrderSubmitted (حدث مخصّص، ليس Purchase) لمن لم يرفض، بمعرّف مختلف عن الشراء", async () => {
    const id = await websiteOrder();
    await settle();
    const all = sendCapiEventMock.mock.calls.map((c) => c[0] as CapiPayload);
    expect(all.map((p) => p.eventName)).toEqual(["OrderSubmitted"]);
    expect(all[0].eventId).not.toBe(purchaseEventId(id));
  });
});
