import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * كل بيعة مؤكَّدة تصل Meta **بقناتها الحقيقية**، مرة واحدة، وبموافقة.
 *
 * الحالات السبع المطلوبة، بالترتيب:
 *  1. طلبية موقع مؤكَّدة.
 *  2. بدأت من الإعلان ثم أُغلقت في واتساب (مرجع Q-).
 *  3. واتساب مباشر بلا مرجع.
 *  4. طلبية يدوية بالهاتف.
 *  5. تأكيد نفس الطلبية مرتين.
 *  6. فشل الإرسال ثم إعادة المحاولة.
 *  7. تأكيد ثم إلغاء.
 *
 * Meta مُحاكاة بالكامل (`sendCapiEvent`): لا شيء يغادر هذه الآلة.
 */

type CapiPayload = {
  eventName: string;
  eventId: string;
  actionSource?: string;
  eventSourceUrl?: string;
  eventTimeMs?: number;
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
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { createOrder } = await import("@/lib/orders/createOrder");
const { createManualOrder } = await import("@/lib/orders/createManualOrder");
const { createWhatsappInquiry } = await import("@/lib/orders/createWhatsappInquiry");
const { createWhatsappLead } = await import("@/lib/orders/createWhatsappLead");
const { updateOrderStatus } = await import("@/app/admin/(protected)/orders/actions");
const { sendDeferredPurchase, purchaseEventId } = await import("@/lib/pixel/sendDeferredPurchase");
const { withInquiryReference } = await import("@/lib/whatsappInquiry");

const PHONE_PREFIX = "064455";
let phoneCounter = 0;
const nextPhone = () => `${PHONE_PREFIX}${String(++phoneCounter).padStart(4, "0")}`;
const SKU = "CHN-FIX-001";
let productId: number;

const FBCLID = "IwZXh0bgNhZW0BMABkdGVzdGNoYW5uZWxz";
const FBCLID_AT = Date.now() - 3_600_000;
const AD_TOUCH = {
  utmSource: "facebook",
  utmMedium: "paid",
  utmCampaign: "TF_WATER_HEATERS_OCT2026",
  utmContent: null,
  utmTerm: null,
  fbclid: FBCLID,
  gclid: null,
  ttclid: null,
  landingPath: "/water-heaters",
  referrerHost: "m.facebook.com",
  at: FBCLID_AT,
};
const VISITOR = {
  clientIpAddress: "105.66.1.20",
  clientUserAgent: "Mozilla/5.0 (Linux; Android 14) FB_IAB",
  fbp: "fb.1.1790000000000.987654321",
  eventSourceUrl: "https://www.tayssirfroid.com/water-heaters",
  analyticsSessionId: randomUUID(),
};

const capiPayloads = () => sendCapiEventMock.mock.calls.map((call) => call[0] as CapiPayload);
const purchaseCalls = () => capiPayloads().filter((p) => p.eventName === "Purchase");

async function waitForPurchases(expected: number) {
  await vi.waitFor(() => expect(purchaseCalls()).toHaveLength(expected), { timeout: 2000, interval: 10 });
  return purchaseCalls();
}

function statusForm(orderId: number, status: string, reason?: string): FormData {
  const fd = new FormData();
  fd.set("orderId", String(orderId));
  fd.set("status", status);
  fd.set("note", "");
  if (reason) fd.set("cancellationReason", reason);
  return fd;
}

function manualInput(overrides: Partial<Parameters<typeof createManualOrder>[0]> = {}) {
  return {
    customer: { fullName: "تاجر اختبار القنوات", phone: nextPhone(), city: "فاس", address: "حي اختبار" },
    source: "whatsapp" as const,
    items: [{ productId, variantId: null, quantity: 10, unitPriceOverride: null }],
    deliveryFee: 35,
    createdByEmail: "admin@local",
    ...overrides,
  };
}

async function inquiry(options: { consent: "granted" | "denied" | "unknown"; withAd: boolean }) {
  const key = randomUUID();
  const result = await createWhatsappInquiry({
    idempotencyKey: key,
    kind: "product",
    productSku: SKU,
    pagePath: "/water-heaters?fbclid=leak",
    attribution: options.withAd ? { first: AD_TOUCH, last: AD_TOUCH } : null,
    requestContext: { ...VISITOR, adConsent: options.consent },
  });
  if (!result.ok) throw new Error(`inquiry failed: ${result.error}`);
  return { key, reference: result.reference };
}

async function orderRow(orderId: number) {
  const [row] = await sql<
    {
      source: string;
      status: string;
      origin_reference: string | null;
      ad_consent: string;
      ad_consent_source: string | null;
      attribution_last: Record<string, unknown> | null;
      capi_identity: Record<string, unknown> | null;
      meta_purchase_accepted_at: Date | null;
      meta_purchase_sent_at: Date | null;
      meta_purchase_error: string | null;
      meta_purchase_action_source: string | null;
    }[]
  >`select source, status, origin_reference, ad_consent, ad_consent_source, attribution_last,
          capi_identity, meta_purchase_accepted_at, meta_purchase_sent_at, meta_purchase_error,
          meta_purchase_action_source
    from public.orders where id = ${orderId}`;
  return row;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [row] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (${SKU}, 'chn-fix-001', ${category.id}, 'قطعة اختبار القنوات', 'قطعة', 1, 1, 30.00, 45.50, 100000, 'published')
    on conflict (sku) do update set stock_quantity = 100000
    returning id
  `;
  productId = row.id;
});

beforeEach(() => {
  sendCapiEventMock.mockClear();
  vi.stubEnv("META_OFFLINE_PURCHASES_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await sql`delete from public.whatsapp_inquiries where product_sku = ${SKU}`;
  await sql`delete from public.orders where customer_phone like ${`${PHONE_PREFIX}%`}`;
  await sql`delete from public.products where sku = ${SKU}`;
});

describe("1. طلبية موقع مؤكَّدة", () => {
  async function websiteOrder(consent: "granted" | "unknown") {
    const result = await createOrder({
      items: [{ productId, variantId: null, quantity: 20 }],
      customer: { fullName: "زبون موقع", phone: nextPhone(), city: "مكناس", address: "عنوان", notes: null },
      idempotencyKey: randomUUID(),
      attribution: { first: AD_TOUCH, last: AD_TOUCH },
      requestContext: { ...VISITOR, adConsent: consent },
    });
    if (!result.ok) throw new Error("website order failed");
    const [row] = await sql<{ id: number }[]>`select id from public.orders where public_reference = ${result.publicReference}`;
    return row.id;
  }

  test("بموافقة: Purchase واحد، website، القيمة الحقيقية بالدرهم، ومعرّف حتمي", async () => {
    const orderId = await websiteOrder("granted");
    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));
    const [call] = await waitForPurchases(1);

    expect(call.actionSource).toBe("website");
    expect(call.eventId).toBe(purchaseEventId(orderId));
    expect(call.customData.currency).toBe("MAD");
    expect(call.customData.value).toBe(910); // 20 × 45.50
    expect(call.eventSourceUrl).toBe(VISITOR.eventSourceUrl);
    expect(call.userData?.country).toBe("ma");
    expect(call.userData?.fbc).toBe(`fb.1.${FBCLID_AT}.${FBCLID}`);
    expect((await orderRow(orderId)).meta_purchase_action_source).toBe("website");
  });

  test("بلا موافقة: الطلبية تُؤكَّد كاملة، ولا شيء يصل Meta", async () => {
    const orderId = await websiteOrder("unknown");
    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));
    expect(await sendDeferredPurchase(orderId)).toEqual({ sent: false, reason: "no_consent" });
    expect(sendCapiEventMock).not.toHaveBeenCalled();
    const row = await orderRow(orderId);
    expect(row.status).toBe("confirmed");
    expect(row.capi_identity).toBeNull();
  });
});

describe("2. بدأت من الإعلان وأُغلقت في واتساب (مرجع Q-)", () => {
  test("المرجع من الرسالة يربط الزيارة: القناة تبقى whatsapp، والبيعة تصل chat مع fbc المُثبَت", async () => {
    const { reference } = await inquiry({ consent: "granted", withAd: true });
    const pastedMessage = withInquiryReference("مرحباً، أريد الاستفسار عن المنتج", reference);

    const result = await createManualOrder(manualInput({ origin: { reference: pastedMessage } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await orderRow(result.orderId);
    expect(row.source).toBe("whatsapp");
    expect(row.origin_reference).toBe(reference);
    expect(row.ad_consent).toBe("granted");
    expect(row.ad_consent_source).toBe("inherited");
    expect(row.attribution_last?.utmCampaign).toBe("TF_WATER_HEATERS_OCT2026");

    const [call] = purchaseCalls();
    expect(purchaseCalls()).toHaveLength(1);
    expect(call.actionSource).toBe("chat");
    expect(call.eventId).toBe(purchaseEventId(result.orderId));
    // fbc من نقرة حقيقية بلحظتها الحقيقية — لا مُختلَق.
    expect(call.userData?.fbc).toBe(`fb.1.${FBCLID_AT}.${FBCLID}`);
    expect(call.userData?.fbp).toBe(VISITOR.fbp);
    // بيعة محادثة لم تقع على صفحة.
    expect(call.eventSourceUrl).toBeUndefined();
    expect(call.customData.value).toBe(455);
    expect(call.customData.currency).toBe("MAD");
    expect(row.meta_purchase_action_source).toBe("chat");

    const [linked] = await sql<{ converted_order_id: number }[]>`
      select converted_order_id from public.whatsapp_inquiries where reference = ${reference}
    `;
    expect(linked.converted_order_id).toBe(result.orderId);
  });

  test("المفتاح مُطفأ (قبل إذن CNDP): الطلبية تُنشأ مربوطة، ولا شيء يصل Meta", async () => {
    vi.stubEnv("META_OFFLINE_PURCHASES_ENABLED", "");
    const { reference } = await inquiry({ consent: "granted", withAd: true });
    const result = await createManualOrder(manualInput({ origin: { reference } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sendCapiEventMock).not.toHaveBeenCalled();
    const row = await orderRow(result.orderId);
    expect(row.origin_reference).toBe(reference);
    expect(row.meta_purchase_sent_at).toBeNull();
  });

  test("الزائر رفض الكوكيز: الاستفسار بلا هوية ولا fbclid، والبيعة لا تُرسَل", async () => {
    const { reference } = await inquiry({ consent: "denied", withAd: true });
    const [stored] = await sql<{ capi_identity: unknown; attribution_last: Record<string, unknown>; page_path: string }[]>`
      select capi_identity, attribution_last, page_path from public.whatsapp_inquiries where reference = ${reference}
    `;
    expect(stored.capi_identity).toBeNull();
    expect(stored.attribution_last.fbclid).toBeNull();
    expect(stored.attribution_last.utmCampaign).toBe("TF_WATER_HEATERS_OCT2026");
    // البارامترات لا تُحفظ في المسار — قد تحمل معرّف نقرة.
    expect(stored.page_path).toBe("/water-heaters");

    const result = await createManualOrder(manualInput({ origin: { reference } }));
    expect(result.ok).toBe(true);
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("مرجع مستعمل أو غير مسجَّل: الطلبية تُرفض كاملة — لا رقم، ولا مخزون، ولا ربط بزيارة غيرها", async () => {
    const { reference } = await inquiry({ consent: "granted", withAd: true });
    const first = await createManualOrder(manualInput({ origin: { reference } }));
    expect(first.ok).toBe(true);

    const [{ stock: before }] = await sql<{ stock: number }[]>`select stock_quantity as stock from public.products where id = ${productId}`;
    const second = await createManualOrder(manualInput({ origin: { reference } }));
    expect(second).toMatchObject({ ok: false, errors: [{ field: "originReference" }] });

    const unknown = await createManualOrder(manualInput({ origin: { reference: "Q-0123456789" } }));
    expect(unknown).toMatchObject({ ok: false, errors: [{ field: "originReference" }] });

    const [{ stock: after }] = await sql<{ stock: number }[]>`select stock_quantity as stock from public.products where id = ${productId}`;
    expect(after).toBe(before);
    expect(purchaseCalls()).toHaveLength(1);
  });

  test("سلة واتساب (W-) عبر النموذج اليدوي: تتحوّل وتنقل إسنادها وهويتها", async () => {
    const lead = await createWhatsappLead({
      items: [{ productId, variantId: null, quantity: 5 }],
      idempotencyKey: randomUUID(),
      attribution: { first: AD_TOUCH, last: AD_TOUCH },
      requestContext: { ...VISITOR, adConsent: "granted" },
    });
    expect(lead.ok).toBe(true);
    if (!lead.ok) return;

    const result = await createManualOrder(manualInput({ origin: { reference: lead.reference } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [leadRow] = await sql<{ status: string; converted_order_id: number }[]>`
      select status, converted_order_id from public.whatsapp_leads where reference = ${lead.reference}
      order by created_at desc limit 1
    `;
    expect(leadRow).toEqual({ status: "converted", converted_order_id: result.orderId });
    const [call] = purchaseCalls();
    expect(call.actionSource).toBe("chat");
    expect(call.userData?.fbc).toBe(`fb.1.${FBCLID_AT}.${FBCLID}`);
  });
});

describe("3. واتساب مباشر بلا مرجع", () => {
  test("بلا موافقة مُصرَّحة: لا شيء يصل Meta", async () => {
    const result = await createManualOrder(manualInput());
    expect(result.ok).toBe(true);
    expect(sendCapiEventMock).not.toHaveBeenCalled();
    if (result.ok) expect((await orderRow(result.orderId)).ad_consent).toBe("unknown");
  });

  test("المدير صرّح بموافقة الزبون: chat بالهاتف وحده — لا fbc ولا fbp ولا IP مُخترَعة", async () => {
    const result = await createManualOrder(manualInput({ adConsentDeclared: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [call] = purchaseCalls();
    expect(call.actionSource).toBe("chat");
    expect(call.userData?.phone).toMatch(/^2126/);
    expect(call.userData?.fbc).toBeUndefined();
    expect(call.userData?.fbp).toBeUndefined();
    expect(call.userData?.clientIpAddress).toBeUndefined();
    expect((await orderRow(result.orderId)).ad_consent_source).toBe("admin_declared");
  });
});

describe("4. طلبية يدوية بالهاتف", () => {
  test("phone_call — لا website أبداً", async () => {
    const result = await createManualOrder(manualInput({ source: "phone", adConsentDeclared: true }));
    expect(result.ok).toBe(true);
    const [call] = purchaseCalls();
    expect(call.actionSource).toBe("phone_call");
  });
});

describe("5. تأكيد نفس الطلبية مرتين", () => {
  test("حدث واحد: إعادة التأكيد والشحن والاستدعاء المباشر لا تُرسل ثانيةً", async () => {
    const result = await createManualOrder(manualInput({ adConsentDeclared: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(purchaseCalls()).toHaveLength(1);

    await updateOrderStatus({ error: null }, statusForm(result.orderId, "confirmed"));
    await updateOrderStatus({ error: null }, statusForm(result.orderId, "shipped"));
    expect(await sendDeferredPurchase(result.orderId)).toEqual({ sent: false, reason: "already_sent" });
    // انتظارٌ قصير لأي نداء `void` متأخّر من تغيير الحالة.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(purchaseCalls()).toHaveLength(1);
  });
});

describe("6. فشل الإرسال ثم إعادة المحاولة", () => {
  test("الفشل يُحرّر الحجز ويُسجّل السبب؛ الإعادة تنجح بنفس event_id، وقبولٌ واحد", async () => {
    sendCapiEventMock.mockResolvedValueOnce({ ok: false, status: 500, error: "HTTP 500 — test" });
    const result = await createManualOrder(manualInput({ adConsentDeclared: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    let row = await orderRow(result.orderId);
    expect(row.meta_purchase_sent_at).toBeNull();
    expect(row.meta_purchase_accepted_at).toBeNull();
    expect(row.meta_purchase_error).toContain("HTTP 500");

    const retry = await sendDeferredPurchase(result.orderId);
    expect(retry).toMatchObject({ sent: true, eventId: purchaseEventId(result.orderId) });
    const calls = purchaseCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].eventId).toBe(calls[1].eventId);

    row = await orderRow(result.orderId);
    expect(row.meta_purchase_accepted_at).not.toBeNull();
    expect(row.meta_purchase_error).toBeNull();
  });
});

describe("7. تأكيد ثم إلغاء", () => {
  test("لا حدث ثانٍ ولا قيمة سالبة؛ القبول يبقى شاهداً لتُحسب الطلبية الملغاة في المطابقة", async () => {
    const result = await createManualOrder(manualInput({ adConsentDeclared: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(purchaseCalls()).toHaveLength(1);

    const cancel = await updateOrderStatus(
      { error: null },
      statusForm(result.orderId, "cancelled", "customer_cancelled")
    );
    expect(cancel.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(capiPayloads()).toHaveLength(1);
    expect(capiPayloads().every((p) => Number(p.customData.value ?? 0) >= 0)).toBe(true);
    const row = await orderRow(result.orderId);
    expect(row.status).toBe("cancelled");
    expect(row.meta_purchase_accepted_at).not.toBeNull();
  });

  test("أُلغيت قبل أي إرسال (بلا موافقة): لا شيء، ولا بعد إعادتها مؤكَّدة بلا موافقة", async () => {
    const result = await createManualOrder(manualInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await updateOrderStatus({ error: null }, statusForm(result.orderId, "cancelled", "duplicate"));
    expect(await sendDeferredPurchase(result.orderId)).toEqual({ sent: false, reason: "not_a_sale" });
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });
});

describe("الاستفسار نفسه", () => {
  test("ضغطتان بنفس المفتاح: استفسار واحد ونفس المرجع", async () => {
    const key = randomUUID();
    const input = { idempotencyKey: key, kind: "general", requestContext: { adConsent: "unknown" as const } };
    const a = await createWhatsappInquiry(input);
    const b = await createWhatsappInquiry(input);
    expect(a).toMatchObject({ ok: true, isNew: true });
    expect(b).toMatchObject({ ok: true, isNew: false });
    if (a.ok && b.ok) expect(a.reference).toBe(b.reference);
    await sql`delete from public.whatsapp_inquiries where idempotency_key = ${key}`;
  });

  test("مفتاح أو نوع غير صالح: يُرفض — لا مرجع تقريبي", async () => {
    expect(await createWhatsappInquiry({ idempotencyKey: "not-a-uuid", kind: "general" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await createWhatsappInquiry({ idempotencyKey: randomUUID(), kind: "order" })).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});

describe("الاحتفاظ: 180 يوماً ثم المحو", () => {
  test("تُمحى الهوية ومعرّفات النقر من الأقدم وحده؛ الطلبية والحملة تبقيان", async () => {
    const phone = nextPhone();
    const touch = sql.json(AD_TOUCH);
    const identity = sql.json({ fbp: VISITOR.fbp, clientIpAddress: VISITOR.clientIpAddress });
    const rows = await sql<{ id: number }[]>`
      insert into public.orders (
        customer_name, customer_phone, customer_city, items_subtotal, status, source,
        attribution_last, capi_identity, ad_consent, created_at
      ) values
        ('قديم', ${phone}, 'فاس', 100, 'delivered', 'website', ${touch}, ${identity}, 'granted', now() - interval '200 days'),
        ('حديث', ${phone}, 'فاس', 100, 'delivered', 'website', ${touch}, ${identity}, 'granted', now() - interval '10 days')
      returning id
    `;

    await sql`select * from public.purge_expired_tracking_identity(180)`;

    const after = await sql<{ id: number; capi_identity: unknown; attribution_last: Record<string, unknown>; items_subtotal: string }[]>`
      select id, capi_identity, attribution_last, items_subtotal from public.orders
      where id = any(${rows.map((r) => r.id)}) order by id
    `;
    expect(after[0].capi_identity).toBeNull();
    expect(after[0].attribution_last.fbclid).toBeUndefined();
    expect(after[0].attribution_last.utmCampaign).toBe("TF_WATER_HEATERS_OCT2026");
    expect(Number(after[0].items_subtotal)).toBe(100);
    expect(after[1].capi_identity).not.toBeNull();
    expect(after[1].attribution_last.fbclid).toBe(FBCLID);
  });
});
