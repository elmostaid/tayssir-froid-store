import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * الشراء يُرسَل عند التأكيد التجاري — مرة واحدة، وبهوية الزبون.
 *
 * ## العطل الذي أوجب هذا الملف
 *
 * طلب الموقع كان يُرسَل إلى Meta كـ`Purchase` لحظة الإرسال. وهو ليس بيعة:
 * الزبون يؤكّد في واتساب بعدها، وما لا يُؤكَّد يُلغى. فتعرف Meta ببيعةٍ ولا
 * تعرف أنها لم تكتمل. القياس: 38 حذفاً مُسجَّلاً بقيمة 45,985 درهم، وتضخيم
 * في قيمة Meta بين 2.4× و6.0× حسب الحملة.
 *
 * ## ثلاث ضمانات تُختبَر هنا، كلّها تُفشِل التصميم لو انكسرت
 *
 * **1. مرة واحدة.** كل رجوع إلى `confirmed` كان سيُرسل شراءً جديداً بلا
 * حارس. والحارس يُطالَب به ذرّياً قبل أي نداء لـMeta.
 *
 * **2. بهوية الزبون لا المدير.** الاستدعاء يأتي من فعل المدير، فلو قُرئت
 * هوية الطلب الحالي (IP/User-Agent/_fbp) لأرسلنا هوية المدير بوصفها هوية
 * الزبون — فتبدو كل التحويلات من شخص واحد. وهذا أسوأ من ألّا نرسل شيئاً.
 *
 * **3. لا شراء لما لم يُبَع.** الطلب الملغى قبل التأكيد لا يُرسَل عنه شيء.
 */

const sendCapiEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/capi", () => ({
  sendCapiEvent: sendCapiEventMock,
  isCapiConfigured: () => true,
  hashForCapi: (value: string) => `sha256(${value})`,
}));

vi.mock("@/lib/auth/requireAdmin", () => ({
  getAdminUser: vi
    .fn()
    .mockResolvedValue({ id: "test-admin", email: "admin@local", role: "admin" }),
  isOwnerAdmin: () => true,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const { createOrder } = await import("@/lib/orders/createOrder");
const { updateOrderStatus } = await import("@/app/admin/(protected)/orders/actions");
const { sendDeferredPurchase, purchaseEventId } = await import(
  "@/lib/pixel/sendDeferredPurchase"
);

const TEST_PHONE_PREFIX = "067777";
let phoneCounter = 0;
let fixtureProductId: number;

// هوية جلسة الزبون كما تُقبَط وقت الإرسال — ولا شيء منها يشبه هوية المدير.
const CUSTOMER_IP = "41.249.100.7";
const CUSTOMER_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) FBAV/450.0";
const CUSTOMER_FBP = "fb.1.1790000000000.1234567890";
const CUSTOMER_FBCLID = "IwZXh0bgNhZW0BMABwZG9mBWFkaWQBqzg8MyFoVnNydGMG";
const CUSTOMER_FBCLID_AT = 1_790_700_720_000;

function nextPhone(): string {
  phoneCounter += 1;
  return `${TEST_PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`;
}

function statusForm(orderId: number, status: string, reason?: string): FormData {
  const fd = new FormData();
  fd.set("orderId", String(orderId));
  fd.set("status", status);
  fd.set("note", "");
  if (reason) fd.set("cancellationReason", reason);
  return fd;
}

async function makeOrder(options: { withAd: boolean }): Promise<number> {
  const touch = {
    utmSource: options.withAd ? "facebook" : null,
    utmMedium: null,
    utmCampaign: options.withAd ? "tf_test" : null,
    utmContent: options.withAd ? "120251771681540742" : null,
    utmTerm: null,
    fbclid: options.withAd ? CUSTOMER_FBCLID : null,
    gclid: null,
    ttclid: null,
    landingPath: "/",
    referrerHost: null,
    at: CUSTOMER_FBCLID_AT,
  };

  const result = await createOrder({
    items: [{ productId: fixtureProductId, variantId: null, quantity: 2 }],
    customer: {
      fullName: "زبون اختبار الشراء المؤجَّل",
      phone: nextPhone(),
      city: "أكادير",
      address: "عنوان اختبار",
      notes: null,
    },
    idempotencyKey: randomUUID(),
    attribution: { first: touch, last: touch },
    requestContext: {
      clientIpAddress: CUSTOMER_IP,
      clientUserAgent: CUSTOMER_UA,
      fbp: CUSTOMER_FBP,
      // كوكي `_fbc` غائبة عمداً: هذه هي الحالة التي أوجبت بناءها من fbclid.
      fbc: undefined,
      eventSourceUrl: "https://tayssirfroid.com/checkout",
      analyticsSessionId: randomUUID(),
    },
  });
  if (!result.ok) throw new Error("fixture order failed: " + JSON.stringify(result.errors));
  const [row] = await sql<{ id: number }[]>`
    select id from public.orders where public_reference = ${result.publicReference}
  `;
  return row.id;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-DEFERRED', 'test-fixture-deferred', ${category.id},
      'منتج اختبار الشراء المؤجَّل', 'قطعة', 1, 1, 100.00, 250.00, 500, 'published'
    )
    on conflict (sku) do update set stock_quantity = 500
    returning id
  `;
  fixtureProductId = product.id;
});

afterAll(async () => {
  await sql`delete from public.stock_movements where product_id = ${fixtureProductId}`;
  await sql`delete from public.orders where customer_phone like ${TEST_PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-DEFERRED'`;
});

beforeEach(() => {
  sendCapiEventMock.mockClear();
});

/** مكالمات Meta من نوع Purchase وحدها (createOrder يُرسل OrderSubmitted). */
function purchaseCalls() {
  return sendCapiEventMock.mock.calls
    .map((call) => call[0])
    .filter((payload) => payload.eventName === "Purchase");
}

/**
 * ينتظر وصول مكالمة الشراء.
 *
 * `updateOrderStatus` تُطلق الإرسال بـ`void` عمداً: نداء شبكة إلى Meta داخل
 * مسار تغيير الحالة يعني أن تعثُّر القياس يُبطئ المدير أو يُفشِل إجراءه.
 * فالاختبار هو من ينتظر، لا الإنتاج.
 */
async function waitForPurchase(expected = 1) {
  await vi.waitFor(() => {
    expect(purchaseCalls()).toHaveLength(expected);
  }, { timeout: 2000, interval: 10 });
  return purchaseCalls();
}

describe("لا شراء قبل التأكيد التجاري", () => {
  test("إرسال الطلب وحده: Meta تسمع OrderSubmitted فقط", async () => {
    await makeOrder({ withAd: true });

    const names = sendCapiEventMock.mock.calls.map((call) => call[0].eventName);
    expect(names).toEqual(["OrderSubmitted"]);
    expect(purchaseCalls()).toHaveLength(0);
  });

  test("طلب أُلغي قبل التأكيد: لا شراء إطلاقاً", async () => {
    const orderId = await makeOrder({ withAd: true });
    sendCapiEventMock.mockClear();

    const result = await updateOrderStatus({ error: null }, statusForm(orderId, "cancelled", "not_confirmed"));
    expect(result.error).toBeNull();

    expect(purchaseCalls()).toHaveLength(0);
    const [row] = await sql<{ meta_purchase_sent_at: Date | null }[]>`
      select meta_purchase_sent_at from public.orders where id = ${orderId}
    `;
    expect(row.meta_purchase_sent_at).toBeNull();
  });

  test("استدعاء مباشر على طلب حالته new: يخرج بـnot_a_sale بلا إرسال", async () => {
    const orderId = await makeOrder({ withAd: true });
    sendCapiEventMock.mockClear();

    const outcome = await sendDeferredPurchase(orderId);
    expect(outcome).toEqual({ sent: false, reason: "not_a_sale" });
    expect(purchaseCalls()).toHaveLength(0);
  });
});

describe("التأكيد يُرسل الشراء — مرة واحدة", () => {
  test("confirmed: شراء واحد بقيمة الطلب ومعرّف حتمي", async () => {
    const orderId = await makeOrder({ withAd: true });
    sendCapiEventMock.mockClear();

    expect((await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"))).error).toBeNull();

    const calls = await waitForPurchase();
    expect(calls[0].eventId).toBe(purchaseEventId(orderId));
    // 2 قطع × 250 = 500
    expect(calls[0].customData.value).toBe(500);
    expect(calls[0].customData.currency).toBe("MAD");
    expect(calls[0].customData.num_items).toBe(2);
  });

  test("confirmed مرتين: شراء واحد فقط — الحارس يمنع الثاني", async () => {
    const orderId = await makeOrder({ withAd: true });
    sendCapiEventMock.mockClear();

    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));
    await waitForPurchase();
    // المدير يرجع الحالة ثم يُعيدها — وهو ما يقع فعلاً عند تصحيح خطأ.
    await updateOrderStatus({ error: null }, statusForm(orderId, "new"));
    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));
    // واستدعاء مباشر ثالث فوق ذلك.
    expect(await sendDeferredPurchase(orderId)).toEqual({ sent: false, reason: "already_sent" });

    expect(purchaseCalls()).toHaveLength(1);
  });

  test("القفز فوق confirmed إلى shipped: الشراء يُرسَل كذلك", async () => {
    // 13 طلباً في الإنتاج (13.7% من المشحونة) وصل shipped دون أن يمرّ
    // بـconfirmed قطّ. ولو رُبط الشراء بـconfirmed حرفياً لاختفت بيعة من كل
    // سبع بسبب اختصار في الواجهة لا علاقة له بالزبون.
    const orderId = await makeOrder({ withAd: true });
    sendCapiEventMock.mockClear();

    expect((await updateOrderStatus({ error: null }, statusForm(orderId, "shipped"))).error).toBeNull();
    await waitForPurchase();
  });

  test("event_time هو لحظة التأكيد لا لحظة الإرسال", async () => {
    const orderId = await makeOrder({ withAd: true });
    sendCapiEventMock.mockClear();

    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));
    await waitForPurchase();

    const [row] = await sql<{ confirmed_at: Date; created_at: Date }[]>`
      select confirmed_at, created_at from public.orders where id = ${orderId}
    `;
    expect(row.confirmed_at).not.toBeNull();
    // لا إرجاع للحدث إلى الخلف ليدخل نافذة الإسناد عنوةً: الوقت المُرسَل هو
    // وقت التأكيد المحفوظ، لا وقت إنشاء الطلب.
    expect(purchaseCalls()[0].eventTimeMs).toBe(new Date(row.confirmed_at).getTime());
  });

  test("confirmed_at يُثبَّت عند أول وصول ولا يُكتب فوقه", async () => {
    const orderId = await makeOrder({ withAd: true });
    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));
    const [first] = await sql<{ confirmed_at: Date }[]>`
      select confirmed_at from public.orders where id = ${orderId}
    `;

    await updateOrderStatus({ error: null }, statusForm(orderId, "shipped"));
    await updateOrderStatus({ error: null }, statusForm(orderId, "delivered"));
    const [later] = await sql<{ confirmed_at: Date }[]>`
      select confirmed_at from public.orders where id = ${orderId}
    `;
    // طلبٌ تقدّم في حالاته لم يُبَع مرتين.
    expect(new Date(later.confirmed_at).getTime()).toBe(new Date(first.confirmed_at).getTime());
  });
});

describe("الهوية هوية الزبون، لا هوية المدير", () => {
  test("lقطة capi_identity تُحفظ وقت الإرسال، وfbc مبنيّة من fbclid", async () => {
    const orderId = await makeOrder({ withAd: true });

    const [row] = await sql<{ capi_identity: Record<string, unknown> }[]>`
      select capi_identity from public.orders where id = ${orderId}
    `;
    expect(row.capi_identity.clientIpAddress).toBe(CUSTOMER_IP);
    expect(row.capi_identity.clientUserAgent).toBe(CUSTOMER_UA);
    expect(row.capi_identity.fbp).toBe(CUSTOMER_FBP);
    expect(row.capi_identity.fbclid).toBe(CUSTOMER_FBCLID);
    // كوكي `_fbc` كانت غائبة، فبُنيت من fbclid ولحظته.
    expect(row.capi_identity.fbc).toBe(`fb.1.${CUSTOMER_FBCLID_AT}.${CUSTOMER_FBCLID}`);
  });

  test("الشراء يُرسَل بهوية الزبون المحفوظة — لا شيء من طلب المدير", async () => {
    const orderId = await makeOrder({ withAd: true });
    sendCapiEventMock.mockClear();

    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));
    await waitForPurchase();

    const userData = purchaseCalls()[0].userData;
    expect(userData.clientIpAddress).toBe(CUSTOMER_IP);
    expect(userData.clientUserAgent).toBe(CUSTOMER_UA);
    expect(userData.fbp).toBe(CUSTOMER_FBP);
    expect(userData.fbc).toBe(`fb.1.${CUSTOMER_FBCLID_AT}.${CUSTOMER_FBCLID}`);
    // ولا شيء من بيئة الاختبار (التي تمثّل متصفح المدير) يتسرّب.
    expect(userData.clientUserAgent).not.toContain("jsdom");
    expect(userData.clientIpAddress).not.toBe("127.0.0.1");
  });

  test("الهاتف يُمرَّر كـph وكـexternal_id — مُعرّف ثابت عبر الأجهزة", async () => {
    const orderId = await makeOrder({ withAd: true });
    sendCapiEventMock.mockClear();

    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));
    await waitForPurchase();

    const userData = purchaseCalls()[0].userData;
    // رقم مغربي دولي بلا "+" — التجزئة تقع داخل sendCapiEvent نفسها.
    expect(userData.phone).toMatch(/^212\d{9}$/);
    expect(userData.externalId).toBe(userData.phone);
  });
});

describe("طلب مباشر بلا إعلان", () => {
  test("لا fbclid ولا fbc — ويبقى الشراء يُرسَل بالهاتف", async () => {
    const orderId = await makeOrder({ withAd: false });

    const [row] = await sql<{ capi_identity: Record<string, unknown> }[]>`
      select capi_identity from public.orders where id = ${orderId}
    `;
    // غياب الإسناد الإعلاني صحيحٌ لا ناقص: لا إعلان فلا نقرة.
    expect(row.capi_identity.fbclid).toBeNull();
    expect(row.capi_identity.fbc).toBeNull();

    sendCapiEventMock.mockClear();
    await updateOrderStatus({ error: null }, statusForm(orderId, "confirmed"));

    const calls = await waitForPurchase();
    expect(calls[0].userData.fbc).toBeUndefined();
    // ولا يُلفَّق شيء: الهاتف وحده يحمل المطابقة.
    expect(calls[0].userData.phone).toMatch(/^212\d{9}$/);
  });
});

describe("الإلغاء يحفظ ولا يمحو", () => {
  test("الطلب الملغى يبقى كاملاً: سطوره وتاريخه وإسناده وسببه", async () => {
    const orderId = await makeOrder({ withAd: true });

    await updateOrderStatus({ error: null }, statusForm(orderId, "cancelled", "price_rejected"));

    const [order] = await sql<
      {
        status: string;
        cancellation_reason: string | null;
        attribution_last: { fbclid?: string } | null;
        capi_identity: Record<string, unknown> | null;
      }[]
    >`
      select status, cancellation_reason, attribution_last, capi_identity
      from public.orders where id = ${orderId}
    `;
    expect(order.status).toBe("cancelled");
    expect(order.cancellation_reason).toBe("price_rejected");
    // الإسناد باقٍ — وهو ما يسمح بقراءة "أي إعلان جاء بطلبات تُلغى".
    expect(order.attribution_last?.fbclid).toBe(CUSTOMER_FBCLID);
    expect(order.capi_identity).not.toBeNull();

    const items = await sql`select id from public.order_items where order_id = ${orderId}`;
    expect(items.length).toBeGreaterThan(0);
    const history = await sql<{ status: string }[]>`
      select status from public.order_status_history where order_id = ${orderId}
    `;
    expect(history.map((h) => h.status)).toContain("cancelled");
  });

  test("الإلغاء بلا سبب: يُرفَض ولا تتغيّر الحالة", async () => {
    const orderId = await makeOrder({ withAd: true });

    const result = await updateOrderStatus({ error: null }, statusForm(orderId, "cancelled"));
    expect(result.error).toMatch(/سبب الإلغاء/);

    const [row] = await sql<{ status: string }[]>`
      select status from public.orders where id = ${orderId}
    `;
    expect(row.status).toBe("new");
  });

  test("سبب «other» بلا ملاحظة: يُرفَض", async () => {
    const orderId = await makeOrder({ withAd: true });

    const result = await updateOrderStatus({ error: null }, statusForm(orderId, "cancelled", "other"));
    expect(result.error).toMatch(/ملاحظة/);

    const [row] = await sql<{ status: string }[]>`
      select status from public.orders where id = ${orderId}
    `;
    expect(row.status).toBe("new");
  });

  test("سبب غير معروف: يُرفَض قبل لمس القاعدة", async () => {
    const orderId = await makeOrder({ withAd: true });

    const result = await updateOrderStatus(
      { error: null },
      statusForm(orderId, "cancelled", "made_up_reason")
    );
    expect(result.error).toMatch(/غير معروف/);

    const [row] = await sql<{ status: string }[]>`
      select status from public.orders where id = ${orderId}
    `;
    expect(row.status).toBe("new");
  });
});
