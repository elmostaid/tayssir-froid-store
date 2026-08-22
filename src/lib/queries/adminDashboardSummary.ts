import { sql } from "@/lib/db";
import { REPORT_TIME_ZONE } from "@/lib/queries/adminAnalytics";

/**
 * خلاصة اليوم مقابل أمس للوحة الرئيسية.
 *
 * **استعلامان اثنان لا أكثر**، وهذا شرط لا زينة: لوحة الإدارة تُفتح عشرات
 * المرات في اليوم من هاتف على شبكة ضعيفة، ومجمّع الاتصالات محدود. فبدل
 * استدعاء دوال صفحة التحليلات مرتين (يوم لكل مدى، سبعة استعلامات لكل مرة)،
 * يطوي كل استعلام هنا اليومين معاً في مرور واحد على البيانات.
 *
 * الطيّ إلى جلسات قبل العدّ هو نفس النمط المقيس في adminAnalytics: أرخص من
 * count(distinct ...) مكرَّرة لكل مرحلة، ويستعمل الفهارس نفسها بلا زيادة.
 *
 * والطلبات هنا **كل المصادر**: هذه لوحة صاحب المتجر، وسؤالها "كم بعتُ
 * اليوم" لا "كم حوّل الموقع". أما نسبة التحويل فمن طلبات الموقع وحدها،
 * لأنها وحدها ما يمكن أن يتحوّل عن زيارة.
 */

export type DayCounters = {
  sessions: number;
  productViewSessions: number;
  addToCartSessions: number;
  checkoutSessions: number;
  abandonedCarts: number;
  orders: number;
  websiteOrders: number;
  salesMad: number;
};

export type DashboardSummary = { today: DayCounters; yesterday: DayCounters };

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const EMPTY: DayCounters = {
  sessions: 0,
  productViewSessions: 0,
  addToCartSessions: 0,
  checkoutSessions: 0,
  abandonedCarts: 0,
  orders: 0,
  websiteOrders: 0,
  salesMad: 0,
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [analytics, orders] = await Promise.all([
    // اليومان معاً: نطوي الأحداث إلى جلسات لكل يوم، ثم نعدّ الجلسات.
    sql<Record<string, unknown>[]>`
      with per_session as (
        select
          (occurred_at at time zone ${REPORT_TIME_ZONE})::date          as day,
          session_id,
          bool_or(event_name = 'product_view')                          as saw_product,
          bool_or(event_name = 'add_to_cart')                           as added,
          bool_or(event_name = 'begin_checkout')                        as checked_out,
          bool_or(event_name = 'purchase')                              as bought
        from public.analytics_events
        where (occurred_at at time zone ${REPORT_TIME_ZONE})::date
              >= (now() at time zone ${REPORT_TIME_ZONE})::date - 1
        group by 1, 2
      )
      select
        to_char(day, 'YYYY-MM-DD')                          as day,
        count(*)                                            as sessions,
        count(*) filter (where saw_product)                 as product_view_sessions,
        count(*) filter (where added)                       as add_to_cart_sessions,
        count(*) filter (where checked_out)                 as checkout_sessions,
        count(*) filter (where added and not bought)        as abandoned_carts
      from per_session
      group by day
    `,
    // الطلبات: كل المصادر للمبيعات، والموقع وحده لنسبة التحويل.
    sql<Record<string, unknown>[]>`
      select
        to_char((created_at at time zone ${REPORT_TIME_ZONE})::date, 'YYYY-MM-DD') as day,
        count(*)                                                     as orders,
        count(*) filter (where source = 'website')                   as website_orders,
        coalesce(sum(items_subtotal) filter (
          where status not in ('cancelled', 'returned')
        ), 0)                                                        as sales
      from public.orders
      where (created_at at time zone ${REPORT_TIME_ZONE})::date
            >= (now() at time zone ${REPORT_TIME_ZONE})::date - 1
      group by 1
    `,
  ]);

  const [{ today, yesterday }] = await sql<{ today: string; yesterday: string }[]>`
    select
      to_char((now() at time zone ${REPORT_TIME_ZONE})::date, 'YYYY-MM-DD')       as today,
      to_char((now() at time zone ${REPORT_TIME_ZONE})::date - 1, 'YYYY-MM-DD')   as yesterday
  `;

  const build = (day: string): DayCounters => {
    const a = analytics.find((row) => row.day === day);
    const o = orders.find((row) => row.day === day);
    return {
      sessions: n(a?.sessions),
      productViewSessions: n(a?.product_view_sessions),
      addToCartSessions: n(a?.add_to_cart_sessions),
      checkoutSessions: n(a?.checkout_sessions),
      abandonedCarts: n(a?.abandoned_carts),
      orders: n(o?.orders),
      websiteOrders: n(o?.website_orders),
      salesMad: n(o?.sales),
    };
  };

  return { today: build(today) ?? EMPTY, yesterday: build(yesterday) ?? EMPTY };
}
