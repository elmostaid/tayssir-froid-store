import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import {
  getAnalyticsByBrowser,
  getAnalyticsByDevice,
  getAnalyticsDaily,
  getAnalyticsSources,
  getAnalyticsTotals,
  getOrdersDaily,
  getOrdersTotals,
  rate,
} from "@/lib/queries/adminAnalytics";
import { resolveRange } from "@/lib/analytics/dateRange";

// اختبار تكامل على Postgres حقيقي: التجميع اليومي بتوقيت المغرب و
// count(distinct) لكل مرحلة هما جوهر اللوحة، ولا يمكن إثباتهما بمحاكاة.

const TZ = "Africa/Casablanca";
const NOW = new Date("2026-08-21T10:00:00Z");
const sessions: string[] = [];

function sid(): string {
  const id = randomUUID();
  sessions.push(id);
  return id;
}

type EventInput = {
  session: string;
  name: string;
  at: string;
  sku?: string;
  orderValue?: number;
  utmSource?: string | null;
  utmCampaign?: string | null;
  device?: string;
  browser?: string;
};

async function seed(events: EventInput[]) {
  for (const e of events) {
    await sql`
      insert into public.analytics_events (
        session_id, event_name, occurred_at, page_path, landing_path,
        utm_source, utm_medium, utm_campaign, utm_content, referrer_host,
        has_click_id, device_type, browser, viewport_w, viewport_h, sku, order_value
      ) values (
        ${e.session}, ${e.name}, ${e.at}, '/', '/',
        ${e.utmSource === undefined ? "facebook" : e.utmSource}, 'paid',
        ${e.utmCampaign === undefined ? "TEST_CAMPAIGN" : e.utmCampaign}, 'ad-01', 'l.facebook.com',
        true, ${e.device ?? "mobile"}, ${e.browser ?? "fb_inapp"}, 393, 851,
        ${e.sku ?? null}, ${e.orderValue ?? null}
      )
    `;
  }
}

const A = sid();
const B = sid();
const C = sid();
const D = sid();

beforeAll(async () => {
  await sql`delete from public.analytics_events`;

  // اليوم 2026-08-19 بتوقيت المغرب (UTC+1):
  //  - الجلسة A: تصفّحت، أضافت للسلة 3 مرات، وصلت Checkout، واشترت.
  //  - الجلسة B: تصفّحت وأضافت للسلة مرة، وتوقّفت.
  //  - الجلسة C: دخلت وغادرت.
  // الجلسة D في يوم آخر (2026-08-20) بلا أي شراء — لاختبار يوم بلا مبيعات.
  await seed([
    { session: A, name: "session_start", at: "2026-08-19T09:00:00Z" },
    { session: A, name: "landing_page_view", at: "2026-08-19T09:00:01Z" },
    { session: A, name: "product_view", at: "2026-08-19T09:01:00Z", sku: "TF-1" },
    { session: A, name: "add_to_cart", at: "2026-08-19T09:02:00Z", sku: "TF-1" },
    { session: A, name: "add_to_cart", at: "2026-08-19T09:03:00Z", sku: "TF-2" },
    { session: A, name: "add_to_cart", at: "2026-08-19T09:04:00Z", sku: "TF-3" },
    { session: A, name: "cart_view", at: "2026-08-19T09:05:00Z" },
    { session: A, name: "begin_checkout", at: "2026-08-19T09:06:00Z" },
    { session: A, name: "purchase", at: "2026-08-19T09:08:00Z", orderValue: 1200 },

    { session: B, name: "session_start", at: "2026-08-19T14:00:00Z" },
    { session: B, name: "landing_page_view", at: "2026-08-19T14:00:01Z" },
    { session: B, name: "product_view", at: "2026-08-19T14:01:00Z", sku: "TF-9" },
    { session: B, name: "add_to_cart", at: "2026-08-19T14:02:00Z", sku: "TF-9" },

    {
      session: C,
      name: "session_start",
      at: "2026-08-19T18:00:00Z",
      device: "desktop",
      browser: "chrome",
      utmSource: null,
      utmCampaign: null,
    },
    {
      session: C,
      name: "landing_page_view",
      at: "2026-08-19T18:00:01Z",
      device: "desktop",
      browser: "chrome",
      utmSource: null,
      utmCampaign: null,
    },

    { session: D, name: "session_start", at: "2026-08-20T11:00:00Z" },
    { session: D, name: "landing_page_view", at: "2026-08-20T11:00:01Z" },
    { session: D, name: "product_view", at: "2026-08-20T11:01:00Z", sku: "TF-4" },
  ]);
});

afterAll(async () => {
  await sql`delete from public.analytics_events where session_id = any(${sessions})`;
});

describe("الأرقام الأساسية — أحداث مقابل أشخاص", () => {
  test("ثلاث جلسات، لكن خمسة أحداث إضافة للسلة من جلستين فقط", async () => {
    const range = resolveRange("custom", "2026-08-19", "2026-08-19", NOW, TZ);
    const totals = await getAnalyticsTotals(range);

    expect(totals.sessions).toBe(3);
    expect(totals.landingPageViews).toBe(3);
    expect(totals.productViewSessions).toBe(2);
    // الفرق الذي بُنيت اللوحة كلها لأجله:
    expect(totals.addToCartEvents).toBe(4);
    expect(totals.addToCartSessions).toBe(2);
    expect(totals.checkoutSessions).toBe(1);
    expect(totals.purchaseEvents).toBe(1);
    expect(totals.trackedRevenueMad).toBe(1200);
  });

  test("عدة إضافات من نفس الجلسة تُحسب شخصاً واحداً", async () => {
    const range = resolveRange("custom", "2026-08-19", "2026-08-19", NOW, TZ);
    const totals = await getAnalyticsTotals(range);
    expect(totals.addToCartEvents).toBeGreaterThan(totals.addToCartSessions);
  });

  test("يوم بلا أي شراء يُعرض بأصفار لا بفراغ", async () => {
    const range = resolveRange("custom", "2026-08-20", "2026-08-20", NOW, TZ);
    const totals = await getAnalyticsTotals(range);
    expect(totals.sessions).toBe(1);
    expect(totals.productViewSessions).toBe(1);
    expect(totals.addToCartSessions).toBe(0);
    expect(totals.purchaseEvents).toBe(0);
    expect(totals.trackedRevenueMad).toBe(0);
  });

  test("فترة بلا أي بيانات ترجع أصفاراً ولا ترمي", async () => {
    const range = resolveRange("custom", "2020-01-01", "2020-01-02", NOW, TZ);
    const totals = await getAnalyticsTotals(range);
    expect(totals.sessions).toBe(0);
    expect(totals.trackedRevenueMad).toBe(0);
    expect(await getAnalyticsDaily(range)).toEqual([]);
    expect(await getAnalyticsSources(range)).toEqual([]);
  });
});

describe("التجميع اليومي بتوقيت المغرب", () => {
  test("كل يوم في صفّه، مرتّبة من الأحدث", async () => {
    const range = resolveRange("custom", "2026-08-19", "2026-08-20", NOW, TZ);
    const daily = await getAnalyticsDaily(range);

    expect(daily.map((d) => d.day)).toEqual(["2026-08-20", "2026-08-19"]);
    const [d20, d19] = daily;
    expect(d19.sessions).toBe(3);
    expect(d19.addToCartEvents).toBe(4);
    expect(d19.addToCartSessions).toBe(2);
    expect(d20.sessions).toBe(1);
    expect(d20.addToCartSessions).toBe(0);
  });

  test("حدث الساعة 23:30 محلياً يبقى في يومه ولا ينزلق لليوم التالي", async () => {
    // يوم منفصل عمداً (17/08) حتى لا يتداخل مع تأكيدات بقية الاختبارات.
    const late = sid();
    // 22:30 UTC = 23:30 بتوقيت المغرب من نفس اليوم.
    await seed([{ session: late, name: "session_start", at: "2026-08-17T22:30:00Z" }]);

    const sameDay = await getAnalyticsDaily(
      resolveRange("custom", "2026-08-17", "2026-08-17", NOW, TZ)
    );
    expect(sameDay).toHaveLength(1);
    expect(sameDay[0].day).toBe("2026-08-17");
    expect(sameDay[0].sessions).toBe(1);

    // ولا يظهر في اليوم التالي — وهو ما كان سيقع لو جمّعنا بتوقيت UTC.
    const nextDay = await getAnalyticsDaily(
      resolveRange("custom", "2026-08-18", "2026-08-18", NOW, TZ)
    );
    expect(nextDay).toEqual([]);
  });
});

describe("المصادر والأجهزة", () => {
  test("الجلسات موزَّعة على المصادر بلا تكرار جلسة في صفّين", async () => {
    const range = resolveRange("custom", "2026-08-19", "2026-08-19", NOW, TZ);
    const sources = await getAnalyticsSources(range);
    const totalSessions = sources.reduce((sum, s) => sum + s.sessions, 0);
    expect(totalSessions).toBe(3);

    const paid = sources.find((s) => s.utmCampaign === "TEST_CAMPAIGN");
    expect(paid?.sessions).toBe(2);
    expect(paid?.addToCartSessions).toBe(2);
    expect(paid?.purchaseEvents).toBe(1);

    const direct = sources.find((s) => s.utmSource === null);
    expect(direct?.sessions).toBe(1);
  });

  test("تقسيم الأجهزة والمتصفحات", async () => {
    const range = resolveRange("custom", "2026-08-19", "2026-08-19", NOW, TZ);
    const devices = await getAnalyticsByDevice(range);
    const browsers = await getAnalyticsByBrowser(range);

    expect(devices.find((d) => d.key === "mobile")?.sessions).toBe(2);
    expect(devices.find((d) => d.key === "desktop")?.sessions).toBe(1);
    expect(browsers.find((b) => b.key === "fb_inapp")?.sessions).toBe(2);
    expect(browsers.find((b) => b.key === "chrome")?.sessions).toBe(1);
  });
});

describe("جدول الطلبات هو المرجع النهائي", () => {
  test("اختلاف الطلبات عن أحداث الشراء يظهر كفارق قابل للقياس", async () => {
    const range = resolveRange("custom", "2026-08-19", "2026-08-19", NOW, TZ);
    const [totals, orders] = await Promise.all([
      getAnalyticsTotals(range),
      getOrdersTotals(range),
    ]);

    // لا توجد طلبات حقيقية في هذا التاريخ داخل قاعدة الاختبار، بينما القياس
    // يحمل حدث شراء واحداً — وهي بالضبط الحالة التي يجب أن تُعرض كملاحظة
    // بدل أن تُخفى أو تُعوَّض.
    expect(totals.purchaseEvents).toBe(1);
    expect(orders.orders).toBe(0);
    expect(orders.orders - totals.purchaseEvents).toBe(-1);
  });

  test("getOrdersDaily لا يرمي على فترة فارغة", async () => {
    const range = resolveRange("custom", "2020-01-01", "2020-01-02", NOW, TZ);
    expect(await getOrdersDaily(range)).toEqual([]);
  });
});

describe("rate — قسمة آمنة", () => {
  test("صفر على صفر يساوي صفراً لا NaN", () => {
    expect(rate(0, 0)).toBe(0);
    expect(rate(5, 0)).toBe(0);
    expect(rate(1, 4)).toBe(25);
  });
});
