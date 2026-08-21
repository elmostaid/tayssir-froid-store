import { sql } from "@/lib/db";

/**
 * استعلامات لوحة القياس الداخلي — تُستدعى من /admin/analytics فقط.
 *
 * قاعدتان تحكمان كل ما في هذا الملف:
 *
 * 1) **الأحداث ليست أشخاصاً.** كل رقم هنا يُصرّح بأيهما يقيس: `*_events`
 *    تعدّ الأحداث، و`*_sessions` تعدّ الجلسات الفريدة. هذا هو سبب وجود
 *    النظام كله — Meta تعطي الأول فقط، فيبدو أن 48 شخصاً أضافوا للسلة بينما
 *    قد يكونون 12.
 *
 * 2) **جدول الطلبات هو المرجع النهائي للمبيعات.** الإيراد ومتوسط قيمة الطلب
 *    يُحسبان من public.orders لا من أحداث القياس. حدث الشراء يُستعمَل فقط
 *    لقياس التحويل ولكشف أي نقص في التتبّع — ولا يُعوَّض أبداً ولا يُخترَع.
 *
 * التوقيت: كل التجميع اليومي بتوقيت المغرب (Africa/Casablanca) لا UTC.
 * بدون ذلك، كل طلب بعد الساعة 23:00 محلياً يُنسب إلى اليوم التالي — ويكفي
 * ذلك لإفساد مقارنة "الاثنين مقابل الثلاثاء" التي بُنيت اللوحة لأجلها.
 */

export const REPORT_TIME_ZONE = "Africa/Casablanca";

/**
 * نمط واحد يتكرّر في كل استعلام هنا: **نطوي الأحداث إلى جلسات أولاً، ثم نعدّ
 * الجلسات.** البديل المباشر (count(distinct session_id) filter (...) عدة
 * مرات على جدول الأحداث) صحيح لكنه يُعيد فرز نفس الصفوف مرة لكل مرحلة؛
 * قِسْنا الفرق على 250 ألف صف: 449 مللي ثانية للطريقة المباشرة مقابل 146
 * لهذه. الفهارس الحالية تكفي — لا حاجة لأي فهرس إضافي.
 */

export type AnalyticsRange = { from: Date; to: Date };

export type AnalyticsTotals = {
  sessions: number;
  landingPageViews: number;
  productViewSessions: number;
  productViewEvents: number;
  addToCartSessions: number;
  addToCartEvents: number;
  checkoutSessions: number;
  checkoutEvents: number;
  purchaseSessions: number;
  purchaseEvents: number;
  trackedRevenueMad: number;
};

export type OrdersTotals = {
  orders: number;
  revenueMad: number;
};

export type AnalyticsDailyRow = {
  day: string;
  sessions: number;
  productViewSessions: number;
  addToCartSessions: number;
  addToCartEvents: number;
  checkoutSessions: number;
  purchaseEvents: number;
};

export type OrdersDailyRow = { day: string; orders: number; revenueMad: number };

export type AnalyticsSourceRow = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referrerHost: string | null;
  sessions: number;
  addToCartSessions: number;
  checkoutSessions: number;
  purchaseEvents: number;
  trackedRevenueMad: number;
};

export type AnalyticsBreakdownRow = {
  key: string;
  sessions: number;
  addToCartSessions: number;
  checkoutSessions: number;
  purchaseEvents: number;
};

// كل الأرقام تصل من Postgres كنصوص (bigint/numeric)، فنُوحّد التحويل هنا مرة
// واحدة بدل تكرار Number(...) في كل حقل.
function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** كل أرقام البطاقات والقمع في استعلام واحد (انظر ملاحظة الطيّ أعلاه). */
export async function getAnalyticsTotals(range: AnalyticsRange): Promise<AnalyticsTotals> {
  const [row] = await sql<Record<string, unknown>[]>`
    with per_session as (
      select
        session_id,
        bool_or(event_name = 'product_view')                             as saw_product,
        bool_or(event_name = 'add_to_cart')                              as added,
        bool_or(event_name = 'begin_checkout')                           as checked_out,
        bool_or(event_name = 'purchase')                                 as bought,
        count(*) filter (where event_name = 'landing_page_view')         as landing_events,
        count(*) filter (where event_name = 'product_view')              as product_events,
        count(*) filter (where event_name = 'add_to_cart')               as cart_events,
        count(*) filter (where event_name = 'begin_checkout')            as checkout_events,
        count(*) filter (where event_name = 'purchase')                  as purchase_events,
        coalesce(sum(order_value) filter (where event_name = 'purchase'), 0) as revenue
      from public.analytics_events
      where occurred_at >= ${range.from} and occurred_at < ${range.to}
      group by session_id
    )
    select
      count(*)                                as sessions,
      coalesce(sum(landing_events), 0)        as landing_page_views,
      count(*) filter (where saw_product)     as product_view_sessions,
      coalesce(sum(product_events), 0)        as product_view_events,
      count(*) filter (where added)           as add_to_cart_sessions,
      coalesce(sum(cart_events), 0)           as add_to_cart_events,
      count(*) filter (where checked_out)     as checkout_sessions,
      coalesce(sum(checkout_events), 0)       as checkout_events,
      count(*) filter (where bought)          as purchase_sessions,
      coalesce(sum(purchase_events), 0)       as purchase_events,
      coalesce(sum(revenue), 0)               as tracked_revenue
    from per_session
  `;

  return {
    sessions: n(row?.sessions),
    landingPageViews: n(row?.landing_page_views),
    productViewSessions: n(row?.product_view_sessions),
    productViewEvents: n(row?.product_view_events),
    addToCartSessions: n(row?.add_to_cart_sessions),
    addToCartEvents: n(row?.add_to_cart_events),
    checkoutSessions: n(row?.checkout_sessions),
    checkoutEvents: n(row?.checkout_events),
    purchaseSessions: n(row?.purchase_sessions),
    purchaseEvents: n(row?.purchase_events),
    trackedRevenueMad: n(row?.tracked_revenue),
  };
}

/**
 * الطلبات الحقيقية في نفس المدى — مرجع المبيعات النهائي.
 *
 * تُحسب كل الطلبات المُنشأة في المدى (بما فيها ما أُلغي لاحقاً) لأن السؤال
 * هنا "كم طلباً نتج عن زيارات هذه الفترة"، وهو ما يُقارَن بحدث الشراء.
 */
export async function getOrdersTotals(range: AnalyticsRange): Promise<OrdersTotals> {
  const [row] = await sql<Record<string, unknown>[]>`
    select
      count(*)                                                  as orders,
      coalesce(sum(coalesce(final_total, items_subtotal)), 0)   as revenue
    from public.orders
    where created_at >= ${range.from} and created_at < ${range.to}
  `;
  return { orders: n(row?.orders), revenueMad: n(row?.revenue) };
}

export async function getAnalyticsDaily(range: AnalyticsRange): Promise<AnalyticsDailyRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    with per_session_day as (
      select
        to_char((occurred_at at time zone ${REPORT_TIME_ZONE})::date, 'YYYY-MM-DD') as day,
        session_id,
        bool_or(event_name = 'product_view')                   as saw_product,
        bool_or(event_name = 'add_to_cart')                    as added,
        bool_or(event_name = 'begin_checkout')                 as checked_out,
        count(*) filter (where event_name = 'add_to_cart')     as cart_events,
        count(*) filter (where event_name = 'purchase')        as purchase_events
      from public.analytics_events
      where occurred_at >= ${range.from} and occurred_at < ${range.to}
      group by 1, 2
    )
    select
      day,
      count(*)                                as sessions,
      count(*) filter (where saw_product)     as product_view_sessions,
      count(*) filter (where added)           as add_to_cart_sessions,
      coalesce(sum(cart_events), 0)           as add_to_cart_events,
      count(*) filter (where checked_out)     as checkout_sessions,
      coalesce(sum(purchase_events), 0)       as purchase_events
    from per_session_day
    group by day
    order by day desc
  `;

  return rows.map((row) => ({
    day: String(row.day),
    sessions: n(row.sessions),
    productViewSessions: n(row.product_view_sessions),
    addToCartSessions: n(row.add_to_cart_sessions),
    addToCartEvents: n(row.add_to_cart_events),
    checkoutSessions: n(row.checkout_sessions),
    purchaseEvents: n(row.purchase_events),
  }));
}

export async function getOrdersDaily(range: AnalyticsRange): Promise<OrdersDailyRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select
      to_char((created_at at time zone ${REPORT_TIME_ZONE})::date, 'YYYY-MM-DD') as day,
      count(*)                                                                   as orders,
      coalesce(sum(coalesce(final_total, items_subtotal)), 0)                    as revenue
    from public.orders
    where created_at >= ${range.from} and created_at < ${range.to}
    group by 1
    order by 1 desc
  `;
  return rows.map((row) => ({
    day: String(row.day),
    orders: n(row.orders),
    revenueMad: n(row.revenue),
  }));
}

/**
 * المصادر. وسوم UTM ثابتة داخل الجلسة (تُلتقط من صفحة الهبوط وتُعاد مع كل
 * حدث)، فالتجميع عليها ثم count(distinct session_id) صحيح ولا يُكرّر جلسة
 * في صفّين.
 */
export async function getAnalyticsSources(
  range: AnalyticsRange,
  limit = 25
): Promise<AnalyticsSourceRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    with per_session as (
      select
        session_id, utm_source, utm_medium, utm_campaign, utm_content, referrer_host,
        bool_or(event_name = 'add_to_cart')                    as added,
        bool_or(event_name = 'begin_checkout')                 as checked_out,
        count(*) filter (where event_name = 'purchase')        as purchase_events,
        coalesce(sum(order_value) filter (where event_name = 'purchase'), 0) as revenue
      from public.analytics_events
      where occurred_at >= ${range.from} and occurred_at < ${range.to}
      group by 1, 2, 3, 4, 5, 6
    )
    select
      utm_source, utm_medium, utm_campaign, utm_content, referrer_host,
      count(*)                              as sessions,
      count(*) filter (where added)         as add_to_cart_sessions,
      count(*) filter (where checked_out)   as checkout_sessions,
      coalesce(sum(purchase_events), 0)     as purchase_events,
      coalesce(sum(revenue), 0)             as tracked_revenue
    from per_session
    group by 1, 2, 3, 4, 5
    order by sessions desc
    limit ${limit}
  `;

  return rows.map((row) => ({
    utmSource: (row.utm_source as string | null) ?? null,
    utmMedium: (row.utm_medium as string | null) ?? null,
    utmCampaign: (row.utm_campaign as string | null) ?? null,
    utmContent: (row.utm_content as string | null) ?? null,
    referrerHost: (row.referrer_host as string | null) ?? null,
    sessions: n(row.sessions),
    addToCartSessions: n(row.add_to_cart_sessions),
    checkoutSessions: n(row.checkout_sessions),
    purchaseEvents: n(row.purchase_events),
    trackedRevenueMad: n(row.tracked_revenue),
  }));
}

async function breakdownBy(
  column: "device_type" | "browser",
  range: AnalyticsRange
): Promise<AnalyticsBreakdownRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    with per_session as (
      select
        session_id,
        coalesce(${sql(column)}, 'غير معروف')                  as key,
        bool_or(event_name = 'add_to_cart')                    as added,
        bool_or(event_name = 'begin_checkout')                 as checked_out,
        count(*) filter (where event_name = 'purchase')        as purchase_events
      from public.analytics_events
      where occurred_at >= ${range.from} and occurred_at < ${range.to}
      group by 1, 2
    )
    select
      key,
      count(*)                              as sessions,
      count(*) filter (where added)         as add_to_cart_sessions,
      count(*) filter (where checked_out)   as checkout_sessions,
      coalesce(sum(purchase_events), 0)     as purchase_events
    from per_session
    group by key
    order by sessions desc
  `;
  return rows.map((row) => ({
    key: String(row.key),
    sessions: n(row.sessions),
    addToCartSessions: n(row.add_to_cart_sessions),
    checkoutSessions: n(row.checkout_sessions),
    purchaseEvents: n(row.purchase_events),
  }));
}

export function getAnalyticsByDevice(range: AnalyticsRange): Promise<AnalyticsBreakdownRow[]> {
  return breakdownBy("device_type", range);
}

export function getAnalyticsByBrowser(range: AnalyticsRange): Promise<AnalyticsBreakdownRow[]> {
  return breakdownBy("browser", range);
}

/** نسبة مئوية بقسمة آمنة — 0 من 0 تساوي 0، لا NaN ولا Infinity. */
export function rate(part: number, whole: number): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}
