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

/** صفّ واحد = جلسة واحدة أضافت للسلة ولم تشترِ. لا يحمل أي بيانات شخصية. */
export type AbandonedCartRow = {
  /** آخر قيمة سلة سجّلها القياس في تلك الجلسة (لا الأكبر). */
  lastCartValueMad: number;
  distinctProducts: number;
  totalUnits: number;
  meetsMinimum: boolean;
  sawCart: boolean;
  reachedCheckout: boolean;
  lastEvent: string;
  sessionSeconds: number;
  utmSource: string | null;
  utmCampaign: string | null;
  referrerHost: string | null;
  deviceType: string | null;
  browser: string | null;
  /** وقت آخر حدث (ISO) — يُعرض بتوقيت المغرب. */
  lastAt: string;
};

export type AbandonedCartsSummary = {
  /** كل الجلسات التي أضافت للسلة ولم تشترِ. مجموع الفئات الثلاث أدناه. */
  abandoned: number;
  stoppedBelowMinimum: number;
  reachedMinimumNoCheckout: number;
  reachedCheckoutNoPurchase: number;
  /** مجموع آخر قيم تلك السلات — ما تُرك على الطاولة. */
  abandonedValueMad: number;
};

export type AbandonedCarts = {
  summary: AbandonedCartsSummary;
  rows: AbandonedCartRow[];
  /** true إذا بلغ عدد الصفوف الحدّ، أي أن القائمة مقصوصة. */
  truncated: boolean;
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

/**
 * السلات المتروكة: كل جلسة أضافت للسلة ولم يُسجَّل لها شراء.
 *
 * ثلاثة قرارات تستحقّ التوضيح:
 *
 * 1) **«آخر قيمة» لا «أكبر قيمة».** cart_value في كل حدث إضافة هو مجموع
 *    السلة بعد تلك الإضافة، فآخر حدث يحمل الحصيلة النهائية. أخذ الأكبر كان
 *    سيُبالغ لو حذف الزبون شيئاً — وإن كنا لا نرصد الحذف أصلاً (لا يوجد
 *    حدث remove_from_cart)، فالرقم يبقى «ما بلغته السلة»، لا جردَ سلةٍ حيّة.
 *
 * 2) **الحد الأدنى يأتي من الإعدادات لا مكتوباً في الكود.** لو غيّرتَ الحد
 *    غداً من 1000 إلى 1200، يتبعه هذا القسم من تلقاء نفسه.
 *
 * 3) **الفئات الثلاث حصرية وجامعة**، فمجموعها يساوي العدد الكلي دائماً:
 *    من فتح Checkout يُحسب هناك مهما كانت سلته، ومن لم يفتحه يُقسَّم على
 *    الحد الأدنى. بلا هذا الترتيب يظهر الشخص الواحد في خانتين فتنكسر الجمعة.
 *
 * وأخيراً: الجلسة التي ضاع حدث شرائها ستظهر هنا خطأً. اللوحة تعرض فوق
 * القسم فارقَ التتبّع إن وُجد، فلا يُقرأ الرقم على أنه يقين.
 */
export async function getAbandonedCarts(
  range: AnalyticsRange,
  minOrderAmountMad: number,
  limit = 100
): Promise<AbandonedCarts> {
  const [row] = await sql<Record<string, unknown>[]>`
    with per_session as (
      select
        session_id,
        max(occurred_at)                                        as last_at,
        coalesce(max(session_ms), 0)                            as session_ms,
        bool_or(event_name = 'cart_view')                       as saw_cart,
        bool_or(event_name = 'begin_checkout')                  as reached_checkout,
        bool_or(event_name = 'purchase')                        as bought,
        count(*) filter (where event_name = 'add_to_cart')      as add_events,
        count(distinct product_id) filter (
          where event_name = 'add_to_cart' and product_id is not null
        )                                                       as distinct_products,
        coalesce(sum(quantity) filter (where event_name = 'add_to_cart'), 0) as total_units,
        (array_agg(cart_value order by occurred_at desc, id desc) filter (
          where event_name = 'add_to_cart' and cart_value is not null
        ))[1]                                                   as last_cart_value,
        (array_agg(event_name order by occurred_at desc, id desc))[1] as last_event,
        -- ثابتة داخل الجلسة (تُلتقط عند صفحة الهبوط وتُعاد مع كل حدث)، لكننا
        -- نُجمّعها بـmax لا نضعها في group by: الضمانة المطلوبة هنا صفّ واحد
        -- لكل جلسة مهما حدث، وأي قيمة شاذّة واحدة كانت ستشطر الجلسة صفّين.
        max(utm_source)                                         as utm_source,
        max(utm_campaign)                                       as utm_campaign,
        max(referrer_host)                                      as referrer_host,
        max(device_type)                                        as device_type,
        max(browser)                                            as browser
      from public.analytics_events
      where occurred_at >= ${range.from} and occurred_at < ${range.to}
      group by session_id
    ),
    abandoned as (
      select *, coalesce(last_cart_value, 0) >= ${minOrderAmountMad} as meets_minimum
      from per_session
      where add_events > 0 and not bought
    )
    select
      (select count(*) from abandoned)                                          as total,
      (select count(*) from abandoned where reached_checkout)                    as checkout_no_purchase,
      (select count(*) from abandoned where not reached_checkout and meets_minimum)     as minimum_no_checkout,
      (select count(*) from abandoned where not reached_checkout and not meets_minimum) as below_minimum,
      (select coalesce(sum(last_cart_value), 0) from abandoned)                  as abandoned_value,
      (
        select coalesce(json_agg(t order by t.last_cart_value desc nulls last, t.last_at desc), '[]'::json)
        from (
          select * from abandoned
          order by last_cart_value desc nulls last, last_at desc
          limit ${limit}
        ) t
      )                                                                          as rows
    from (select 1) as _
  `;

  const rawRows = (row?.rows ?? []) as Array<Record<string, unknown>>;

  return {
    summary: {
      abandoned: n(row?.total),
      stoppedBelowMinimum: n(row?.below_minimum),
      reachedMinimumNoCheckout: n(row?.minimum_no_checkout),
      reachedCheckoutNoPurchase: n(row?.checkout_no_purchase),
      abandonedValueMad: n(row?.abandoned_value),
    },
    rows: rawRows.map((r) => ({
      lastCartValueMad: n(r.last_cart_value),
      distinctProducts: n(r.distinct_products),
      totalUnits: n(r.total_units),
      meetsMinimum: Boolean(r.meets_minimum),
      sawCart: Boolean(r.saw_cart),
      reachedCheckout: Boolean(r.reached_checkout),
      lastEvent: String(r.last_event ?? ""),
      sessionSeconds: Math.round(n(r.session_ms) / 1000),
      utmSource: (r.utm_source as string | null) ?? null,
      utmCampaign: (r.utm_campaign as string | null) ?? null,
      referrerHost: (r.referrer_host as string | null) ?? null,
      deviceType: (r.device_type as string | null) ?? null,
      browser: (r.browser as string | null) ?? null,
      lastAt: String(r.last_at ?? ""),
    })),
    truncated: rawRows.length >= limit,
  };
}

/** نسبة مئوية بقسمة آمنة — 0 من 0 تساوي 0، لا NaN ولا Infinity. */
export function rate(part: number, whole: number): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}
