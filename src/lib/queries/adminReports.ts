import { sql } from "@/lib/db";

// تقارير الأرباح فقط — لوحة الإدارة حصرياً، تعتمد على purchase_price السري
// (لا تُستعمل أبداً خارج مسارات /admin، ولا يظهر ثمن الشراء أو الربح في أي
// واجهة يراها الزبون).
//
// ملاحظة عن دقة التكلفة (COGS): order_items.purchase_price_snapshot (منذ
// migration 20260807000000) يخزّن ثمن الشراء الفعلي وقت إنشاء الطلب —
// variant.purchase_price_override إن وُجد، وإلا product.purchase_price،
// كما كانا وقتها بالضبط. الحساب هنا يعتمد عليه أولاً، فربح طلب مسلَّم لا
// يتغيّر بعد ذلك أبداً حتى لو عُدِّل ثمن شراء المنتج لاحقاً.
//
// الطلبات السابقة لتلك الهجرة (purchase_price_snapshot = NULL) ليس لها أي
// snapshot تاريخي حقيقي — لا يوجد مصدر بيانات آخر لثمن الشراء وقتها، ولا
// يجوز تخمينه. لتلك الطلبات فقط، الحساب يرجع لثمن الشراء **الحالي** كـ
// "تقدير تاريخي" (historical approximation) — يتغيّر بأثر رجعي إذا عُدِّل
// ثمن الشراء لاحقاً، وموسوم صراحة فالنتائج (has_full_snapshot/
// isHistoricalApproximation) لتُعرَض بوضوح فالواجهة، وليس كرقم دقيق. منتج
// محذوف بالكامل لاحقاً (product_id يصبح null عبر on delete set null)
// يُحتسَب بتكلفة صفر لتلك السطور تحديداً (COALESCE)، فيظهر ربحها الظاهري
// أعلى من الحقيقي — محدود الأثر عملياً (نادر) لكن يستحق الذكر.
//
// "الربح الإجمالي" (gross profit) = items_subtotal - COGS، من طلبات
// delivered فقط. لا يشمل مصاريف التوصيل (تكلفة لوجستية وليست ربح بضاعة)،
// ولا يُخصَم منه أي مصروف تشغيلي آخر.

export type ProfitSummary = {
  deliveredOrdersCount: number;
  deliveredRevenueMad: string;
  cancelledOrdersCount: number;
  returnedOrdersCount: number;
  cogsMad: string;
  grossProfitMad: string;
  profitTodayMad: string;
  profitLast7DaysMad: string;
  profitThisMonthMad: string;
  // عدد الطلبات المسلَّمة التي لا تملك purchase_price_snapshot لسطر واحد
  // على الأقل — ربحها معروض بـ"تقدير تاريخي" (ثمن شراء حالي)، وليس بدقة.
  approximateProfitOrdersCount: number;
};

const ORDER_COGS_CTE = sql`
  with order_cogs as (
    select
      oi.order_id,
      sum(
        oi.quantity * coalesce(oi.purchase_price_snapshot, pv.purchase_price_override, p.purchase_price, 0)
      ) as cogs,
      bool_and(oi.purchase_price_snapshot is not null) as has_full_snapshot
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    left join public.product_variants pv on pv.id = oi.variant_id
    group by oi.order_id
  )
`;

export async function getProfitSummary(): Promise<ProfitSummary> {
  const [row] = await sql<
    {
      delivered_orders_count: number;
      delivered_revenue: string;
      cancelled_orders_count: number;
      returned_orders_count: number;
      cogs_total: string;
      gross_profit_total: string;
      profit_today: string;
      profit_7d: string;
      profit_month: string;
      approximate_profit_orders_count: number;
    }[]
  >`
    ${ORDER_COGS_CTE}
    select
      count(*) filter (where o.status = 'delivered')::int as delivered_orders_count,
      coalesce(sum(o.items_subtotal) filter (where o.status = 'delivered'), 0) as delivered_revenue,
      count(*) filter (where o.status = 'cancelled')::int as cancelled_orders_count,
      count(*) filter (where o.status = 'returned')::int as returned_orders_count,
      coalesce(sum(oc.cogs) filter (where o.status = 'delivered'), 0) as cogs_total,
      count(*) filter (
        where o.status = 'delivered' and coalesce(oc.has_full_snapshot, true) = false
      )::int as approximate_profit_orders_count,
      coalesce(sum(o.items_subtotal - coalesce(oc.cogs, 0)) filter (where o.status = 'delivered'), 0)
        as gross_profit_total,
      coalesce(sum(o.items_subtotal - coalesce(oc.cogs, 0)) filter (
        where o.status = 'delivered' and o.created_at >= current_date
      ), 0) as profit_today,
      coalesce(sum(o.items_subtotal - coalesce(oc.cogs, 0)) filter (
        where o.status = 'delivered' and o.created_at >= current_date - interval '6 days'
      ), 0) as profit_7d,
      coalesce(sum(o.items_subtotal - coalesce(oc.cogs, 0)) filter (
        where o.status = 'delivered' and o.created_at >= date_trunc('month', current_date)
      ), 0) as profit_month
    from public.orders o
    left join order_cogs oc on oc.order_id = o.id
  `;

  return {
    deliveredOrdersCount: row?.delivered_orders_count ?? 0,
    deliveredRevenueMad: row?.delivered_revenue ?? "0",
    cancelledOrdersCount: row?.cancelled_orders_count ?? 0,
    returnedOrdersCount: row?.returned_orders_count ?? 0,
    cogsMad: row?.cogs_total ?? "0",
    grossProfitMad: row?.gross_profit_total ?? "0",
    profitTodayMad: row?.profit_today ?? "0",
    profitLast7DaysMad: row?.profit_7d ?? "0",
    profitThisMonthMad: row?.profit_month ?? "0",
    approximateProfitOrdersCount: row?.approximate_profit_orders_count ?? 0,
  };
}

export type DeliveredOrderProfit = {
  orderId: number;
  orderNumber: string;
  createdAt: string;
  revenueMad: string;
  cogsMad: string;
  profitMad: string;
  // false إذا كان لسطر واحد فأكثر بهذا الطلب purchase_price_snapshot = NULL
  // (طلب سابق لـmigration 20260807000000) — الربح المعروض حينها تقدير
  // تاريخي بثمن الشراء الحالي، وليس دقيقاً.
  isExactHistoricalProfit: boolean;
};

export async function getDeliveredOrdersProfitBreakdown(
  limit: number
): Promise<DeliveredOrderProfit[]> {
  const rows = await sql<
    {
      id: number;
      order_number: string;
      created_at: string;
      items_subtotal: string;
      cogs: string;
      profit: string;
      has_full_snapshot: boolean | null;
    }[]
  >`
    ${ORDER_COGS_CTE}
    select
      o.id, o.order_number, o.created_at, o.items_subtotal,
      coalesce(oc.cogs, 0) as cogs,
      (o.items_subtotal - coalesce(oc.cogs, 0)) as profit,
      oc.has_full_snapshot
    from public.orders o
    left join order_cogs oc on oc.order_id = o.id
    where o.status = 'delivered'
    order by o.created_at desc
    limit ${limit}
  `;

  return rows.map((r) => ({
    orderId: r.id,
    orderNumber: r.order_number,
    createdAt: r.created_at,
    revenueMad: r.items_subtotal,
    cogsMad: r.cogs,
    profitMad: r.profit,
    isExactHistoricalProfit: r.has_full_snapshot ?? true,
  }));
}

export type BestSellingProduct = {
  sku: string;
  name: string;
  totalQuantity: number;
  totalValueMad: string;
};

// الأكثر مبيعاً من الطلبات delivered فقط (نفس نطاق تقرير الأرباح — منسجم
// معه)، وليس كل الطلبات الصالحة كما فـDashboard العام. sku_snapshot هو
// المعرّف المستقر هنا (وليس product_id، الذي قد يصبح null بعد حذف المنتج).
export async function getBestSellingProducts(
  sortBy: "quantity" | "value",
  limit: number
): Promise<BestSellingProduct[]> {
  const orderBy =
    sortBy === "quantity" ? sql`order by total_quantity desc` : sql`order by total_value desc`;

  const rows = await sql<
    { sku: string; name: string; total_quantity: number; total_value: string }[]
  >`
    select
      oi.sku_snapshot as sku,
      (array_agg(oi.product_name_snapshot order by o.created_at desc))[1] as name,
      sum(oi.quantity)::int as total_quantity,
      sum(oi.line_total) as total_value
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status = 'delivered'
    group by oi.sku_snapshot
    ${orderBy}
    limit ${limit}
  `;

  return rows.map((r) => ({
    sku: r.sku,
    name: r.name,
    totalQuantity: r.total_quantity,
    totalValueMad: r.total_value,
  }));
}
