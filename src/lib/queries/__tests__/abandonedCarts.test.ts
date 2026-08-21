import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { getAbandonedCarts } from "@/lib/queries/adminAnalytics";
import { resolveRange } from "@/lib/analytics/dateRange";

/**
 * اختبار تكامل على Postgres حقيقي. السببان اللذان يجعلان المحاكاة عديمة
 * الجدوى هنا: «آخر قيمة للسلة» تعتمد على ترتيب فعلي داخل التجميع، وحصرية
 * الفئات الثلاث لا تُثبَت إلا بجمعها على بيانات حقيقية.
 */

const TZ = "Africa/Casablanca";
const NOW = new Date("2026-08-21T10:00:00Z");
const DAY = "2026-08-19";
const MIN = 1000;

const sessions: string[] = [];
function sid(): string {
  const id = randomUUID();
  sessions.push(id);
  return id;
}

type Ev = {
  session: string;
  name: string;
  at: string;
  productId?: number | null;
  quantity?: number | null;
  cartValue?: number | null;
  sessionMs?: number;
  device?: string;
  browser?: string;
  utmSource?: string | null;
  utmCampaign?: string | null;
};

let productIds: number[] = [];

async function seed(events: Ev[]) {
  for (const e of events) {
    await sql`
      insert into public.analytics_events (
        session_id, event_name, occurred_at, page_path, landing_path,
        utm_source, utm_medium, utm_campaign, referrer_host, has_click_id,
        device_type, browser, viewport_w, viewport_h,
        product_id, quantity, cart_value, session_ms
      ) values (
        ${e.session}, ${e.name}, ${e.at}, '/', '/',
        ${e.utmSource === undefined ? "facebook" : e.utmSource}, 'paid',
        ${e.utmCampaign === undefined ? "CAMP_A" : e.utmCampaign}, 'l.facebook.com', true,
        ${e.device ?? "mobile"}, ${e.browser ?? "fb_inapp"}, 393, 851,
        ${e.productId ?? null}, ${e.quantity ?? null}, ${e.cartValue ?? null},
        ${e.sessionMs ?? null}
      )
    `;
  }
}

// A اشترى، B تحت الحد الأدنى، C بلغه بلا Checkout، D فتح Checkout بلا شراء،
// E دخل ولم يُضف شيئاً، F حذف ثم أضاف فانخفضت القيمة المسجَّلة،
// G حذف ولم يُضف بعدها ولم يفتح Checkout (الحالة التي تعمى عنها البيانات)،
// H حذف ثم فتح Checkout (فوصلتنا القيمة الحقيقية بعد الحذف).
const A = sid();
const B = sid();
const C = sid();
const D = sid();
const E = sid();
const F = sid();
const G = sid();
const H = sid();

beforeAll(async () => {
  const rows = await sql<{ id: number }[]>`select id from public.products order by id limit 3`;
  productIds = rows.map((r) => Number(r.id));
  expect(productIds.length).toBe(3);
  const [p1, p2, p3] = productIds;

  await seed([
    { session: A, name: "session_start", at: `${DAY}T09:00:00Z`, sessionMs: 0 },
    { session: A, name: "add_to_cart", at: `${DAY}T09:02:00Z`, productId: p1, quantity: 2, cartValue: 1500, sessionMs: 120000 },
    { session: A, name: "begin_checkout", at: `${DAY}T09:06:00Z`, cartValue: 1500, sessionMs: 360000 },
    { session: A, name: "purchase", at: `${DAY}T09:08:00Z`, sessionMs: 480000 },

    { session: B, name: "session_start", at: `${DAY}T14:00:00Z`, sessionMs: 0 },
    { session: B, name: "add_to_cart", at: `${DAY}T14:02:00Z`, productId: p1, quantity: 1, cartValue: 150, sessionMs: 120000 },

    { session: C, name: "session_start", at: `${DAY}T15:00:00Z`, sessionMs: 0 },
    { session: C, name: "add_to_cart", at: `${DAY}T15:01:00Z`, productId: p1, quantity: 3, cartValue: 600, sessionMs: 60000 },
    { session: C, name: "add_to_cart", at: `${DAY}T15:02:00Z`, productId: p2, quantity: 2, cartValue: 1200, sessionMs: 120000 },
    { session: C, name: "cart_view", at: `${DAY}T15:03:00Z`, sessionMs: 180000 },

    { session: D, name: "session_start", at: `${DAY}T16:00:00Z`, sessionMs: 0, device: "desktop", browser: "chrome", utmSource: null, utmCampaign: null },
    { session: D, name: "add_to_cart", at: `${DAY}T16:01:00Z`, productId: p3, quantity: 1, cartValue: 300, sessionMs: 60000, device: "desktop", browser: "chrome", utmSource: null, utmCampaign: null },
    { session: D, name: "cart_view", at: `${DAY}T16:02:00Z`, sessionMs: 120000, device: "desktop", browser: "chrome", utmSource: null, utmCampaign: null },
    { session: D, name: "begin_checkout", at: `${DAY}T16:03:00Z`, sessionMs: 180000, device: "desktop", browser: "chrome", utmSource: null, utmCampaign: null },

    { session: E, name: "session_start", at: `${DAY}T17:00:00Z`, sessionMs: 0 },
    { session: E, name: "product_view", at: `${DAY}T17:01:00Z`, productId: p1 },

    // F أضاف حتى 1400 ثم حذف **ثم أضاف مجدداً**، فسجّلت الإضافة الأخيرة 400.
    { session: F, name: "session_start", at: `${DAY}T18:00:00Z`, sessionMs: 0 },
    { session: F, name: "add_to_cart", at: `${DAY}T18:01:00Z`, productId: p1, quantity: 7, cartValue: 1400, sessionMs: 60000 },
    { session: F, name: "add_to_cart", at: `${DAY}T18:02:00Z`, productId: p1, quantity: 2, cartValue: 400, sessionMs: 120000 },

    // G هي الحالة التي أثبتناها حرفياً على Preview: رفع سلته إلى 1420، فتح
    // السلة، حذف حتى 350، ولم يُضف شيئاً ولم يفتح Checkout. الحذف لا يُنتج
    // حدثاً و cart_view لا يحمل قيمة — فلا أثر للـ350 في البيانات إطلاقاً.
    { session: G, name: "session_start", at: `${DAY}T19:00:00Z`, sessionMs: 0 },
    { session: G, name: "add_to_cart", at: `${DAY}T19:01:00Z`, productId: p1, quantity: 1, cartValue: 900, sessionMs: 60000 },
    { session: G, name: "add_to_cart", at: `${DAY}T19:02:00Z`, productId: p2, quantity: 1, cartValue: 1250, sessionMs: 120000 },
    { session: G, name: "add_to_cart", at: `${DAY}T19:03:00Z`, productId: p3, quantity: 1, cartValue: 1420, sessionMs: 180000 },
    { session: G, name: "cart_view", at: `${DAY}T19:04:00Z`, sessionMs: 240000 },

    // H نفس القصة لكنه فتح Checkout بعد الحذف، فحمل الحدث المجموع الحيّ.
    { session: H, name: "session_start", at: `${DAY}T20:00:00Z`, sessionMs: 0 },
    { session: H, name: "add_to_cart", at: `${DAY}T20:01:00Z`, productId: p1, quantity: 1, cartValue: 1420, sessionMs: 60000 },
    { session: H, name: "cart_view", at: `${DAY}T20:02:00Z`, sessionMs: 120000 },
    { session: H, name: "begin_checkout", at: `${DAY}T20:03:00Z`, cartValue: 350, sessionMs: 180000 },
  ]);
});

afterAll(async () => {
  await sql`delete from public.analytics_events where session_id = any(${sessions})`;
});

const day = () => resolveRange("custom", DAY, DAY, NOW, TZ);
const forSession = async (cartValue: number) => {
  const { rows } = await getAbandonedCarts(day(), MIN);
  const row = rows.find((r) => r.lastCartValueMad === cartValue);
  expect(row).toBeDefined();
  return row!;
};

describe("السلات المتروكة — من أضاف ولم يشترِ", () => {
  test("من اشترى لا يظهر، ومن لم يُضف شيئاً لا يظهر", async () => {
    const { summary, rows } = await getAbandonedCarts(day(), MIN);

    // B و C و D و F و G و H — لا A (اشترى) ولا E (لم يُضف).
    expect(summary.abandoned).toBe(6);
    expect(rows.map((r) => r.lastCartValueMad)).not.toContain(1500);
  });

  test("الفئات الثلاث حصرية وجامعة — مجموعها يساوي العدد الكلي دائماً", async () => {
    const { summary } = await getAbandonedCarts(day(), MIN);

    expect(summary.stoppedBelowMinimum).toBe(2); // B (150) و F (400)
    expect(summary.reachedMinimumNoCheckout).toBe(2); // C (1200) و G (1420 مسجَّلة)
    expect(summary.reachedCheckoutNoPurchase).toBe(2); // D و H — القيمة من Checkout
    expect(
      summary.stoppedBelowMinimum +
        summary.reachedMinimumNoCheckout +
        summary.reachedCheckoutNoPurchase
    ).toBe(summary.abandoned);
  });

  test("من فتح Checkout يُحسب هناك مهما كانت سلته — فلا يظهر في خانتين", async () => {
    const { summary } = await getAbandonedCarts(day(), MIN);
    // D سلته 300 (تحت الحد الأدنى) لكنه فتح Checkout: يُحسب مرة واحدة فقط.
    expect(summary.reachedCheckoutNoPurchase).toBe(2);
    expect(summary.stoppedBelowMinimum).toBe(2);
  });

  test("«آخر قيمة» لا «أكبر قيمة»: من بلغت سلته 1400 ثم نزلت إلى 400 يُحسب تحت الحد", async () => {
    const { rows, summary } = await getAbandonedCarts(day(), MIN);

    expect(rows.map((r) => r.lastCartValueMad)).toContain(400);
    expect(rows.map((r) => r.lastCartValueMad)).not.toContain(1400);
    expect((await forSession(400)).meetsMinimum).toBe(false);
    expect(summary.abandonedValueMad).toBe(150 + 1200 + 300 + 400 + 1420 + 350);
  });

  test("عدد المنتجات المختلفة ومجموع الكميات محسوبان من أحداث الإضافة وحدها", async () => {
    const c = await forSession(1200);
    expect(c.distinctProducts).toBe(2);
    expect(c.totalUnits).toBe(5);

    // F أضاف نفس المنتج مرتين: منتج واحد مختلف، تسع وحدات.
    const f = await forSession(400);
    expect(f.distinctProducts).toBe(1);
    expect(f.totalUnits).toBe(9);
  });

  test("مسار الجلسة: فتح السلة، Checkout، وآخر حدث", async () => {
    const c = await forSession(1200);
    expect(c.sawCart).toBe(true);
    expect(c.reachedCheckout).toBe(false);
    expect(c.lastEvent).toBe("cart_view");

    const d = await forSession(300);
    expect(d.sawCart).toBe(true);
    expect(d.reachedCheckout).toBe(true);
    expect(d.lastEvent).toBe("begin_checkout");

    const b = await forSession(150);
    expect(b.sawCart).toBe(false);
    expect(b.reachedCheckout).toBe(false);
    expect(b.lastEvent).toBe("add_to_cart");
  });

  test("مدة الجلسة والمصدر والجهاز والمتصفح", async () => {
    const c = await forSession(1200);
    expect(c.sessionSeconds).toBe(180);
    expect(c.utmSource).toBe("facebook");
    expect(c.utmCampaign).toBe("CAMP_A");
    expect(c.deviceType).toBe("mobile");
    expect(c.browser).toBe("fb_inapp");

    const d = await forSession(300);
    expect(d.utmSource).toBeNull();
    expect(d.utmCampaign).toBeNull();
    expect(d.deviceType).toBe("desktop");
    expect(d.browser).toBe("chrome");
  });

  test("الترتيب: الأثمن أولاً — أول ما يجب أن تراه", async () => {
    const { rows } = await getAbandonedCarts(day(), MIN);
    expect(rows.map((r) => r.lastCartValueMad)).toEqual([1420, 1200, 400, 350, 300, 150]);
  });

  test("الحد الأدنى يأتي من الإعدادات: تغييره يُعيد توزيع الفئات فوراً", async () => {
    const { summary } = await getAbandonedCarts(day(), 350);

    // بحدّ 350: C و F و G فوقه، B تحته، و D و H في خانة Checkout كما هما.
    expect(summary.reachedMinimumNoCheckout).toBe(3);
    expect(summary.stoppedBelowMinimum).toBe(1);
    expect(summary.reachedCheckoutNoPurchase).toBe(2);
    expect(summary.abandoned).toBe(6);
  });

  test("الحالة العمياء: حذفٌ بلا إضافة بعده وبلا Checkout — نعرض المسجَّل ونُصرّح بأنه حدّ أعلى", async () => {
    // ثبتت هذه الحالة حرفياً على Preview: السلة انتهت عند 350 والبيانات لا
    // تعرف إلا 1420. لا نستطيع تصحيح الرقم — لكننا نمنع قراءته يقيناً.
    const g = await forSession(1420);
    expect(g.valueSource).toBe("add_to_cart");
    expect(g.lastEvent).toBe("cart_view");
    expect(g.reachedCheckout).toBe(false);
  });

  test("من فتح Checkout: القيمة من begin_checkout لا من آخر إضافة — وتعكس الحذف", async () => {
    const { rows } = await getAbandonedCarts(day(), MIN);

    // H أضاف حتى 1420 ثم حذف حتى 350 ثم فتح Checkout.
    const h = rows.find((r) => r.valueSource === "checkout" && r.lastCartValueMad === 350);
    expect(h).toBeDefined();
    expect(h!.meetsMinimum).toBe(false);
    // 1420 الخاصة به لا تظهر إطلاقاً: قيمة Checkout تغلبها.
    expect(rows.filter((r) => r.lastCartValueMad === 1420)).toHaveLength(1);
  });

  test("كل صفّ يُصرّح بمصدر قيمته", async () => {
    const { rows } = await getAbandonedCarts(day(), MIN);
    for (const row of rows) {
      expect(["checkout", "add_to_cart"]).toContain(row.valueSource);
      expect(row.valueSource === "checkout").toBe(row.reachedCheckout && row.lastCartValueMad === 350);
    }
  });

  test("لكل جلسة صفّ واحد لا أكثر", async () => {
    const { rows, summary } = await getAbandonedCarts(day(), MIN);
    expect(rows).toHaveLength(summary.abandoned);
  });

  test("الحدّ الأعلى يُعلَن صراحةً بدل أن يُخفي صفوفاً بصمت", async () => {
    const limited = await getAbandonedCarts(day(), MIN, 2);
    expect(limited.rows).toHaveLength(2);
    expect(limited.truncated).toBe(true);
    // الخلاصة تبقى على كل الجلسات، لا على المعروض منها فقط.
    expect(limited.summary.abandoned).toBe(6);
  });

  test("فترة بلا أي حدث تُرجع خلاصة أصفار بلا انفجار", async () => {
    const empty = await getAbandonedCarts(
      resolveRange("custom", "2026-01-05", "2026-01-05", NOW, TZ),
      MIN
    );
    expect(empty.summary.abandoned).toBe(0);
    expect(empty.summary.abandonedValueMad).toBe(0);
    expect(empty.rows).toEqual([]);
    expect(empty.truncated).toBe(false);
  });
});
