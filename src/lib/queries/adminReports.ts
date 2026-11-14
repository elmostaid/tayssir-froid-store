import { sql } from "@/lib/db";
import { REPORT_TIME_ZONE } from "@/lib/queries/adminAnalytics";

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

// دالة (وليس ثابتاً على مستوى الوحدة) عمداً: sql`...` يستدعي getClient()
// فوراً بمجرد التنفيذ (راجع db.ts — Proxy الـapply trap)، فلو كان هذا
// ثابتاً مُحسَباً وقت تحميل الوحدة (module scope)، مجرد استيراد هذا الملف
// (يحدث حتماً عند "Collecting page data" أثناء next build لأي صفحة تستورد
// adminReports.ts) كان يفتح/يتحقق من DATABASE_URL وقت البناء لا وقت
// التشغيل — بالضبط ما كان يُسقط build كامل الموقع بمجرد أن يكون
// DATABASE_URL مضبوطاً بقيمة مشوَّهة فبيئة واحدة (Preview) فقط، رغم عدم
// استدعاء أي دالة استعلام هنا فعلياً. الآن يُستدعى فقط داخل كل دالة تستعمله
// وقت التنفيذ الحقيقي، مطابقاً لنفس افتراض "لا اتصال بقاعدة البيانات إلا
// عند أول استعلام فعلي" الموثَّق فـdb.ts.
function orderCogsCte() {
  return sql`
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
}

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
    ${orderCogsCte()}
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
  /** المحصَّل من الزبون للتوصيل. null = لم يُحدَّد. */
  deliveryFeeMad: string | null;
  /** المدفوع لشركة التوصيل. null = **غير مسجَّلة**، وليس صفراً. */
  actualDeliveryCostMad: string | null;
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
      delivery_fee: string | null;
      actual_delivery_cost: string | null;
      has_full_snapshot: boolean | null;
    }[]
  >`
    ${orderCogsCte()}
    select
      o.id, o.order_number, o.created_at, o.items_subtotal,
      o.delivery_fee, o.actual_delivery_cost,
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
    deliveryFeeMad: r.delivery_fee,
    actualDeliveryCostMad: r.actual_delivery_cost,
    isExactHistoricalProfit: r.has_full_snapshot ?? true,
  }));
}

// ─────────────────── المبيعات والأرباح حسب المصدر ───────────────────

/**
 * تفصيل المبيعات حسب مصدر الطلب داخل مدى زمني.
 *
 * ثلاثة قرارات تحكم هذه الأرقام:
 *
 * 1) **الربح من الطلبات المسلَّمة وحدها** — نفس أساس بقية هذه الصفحة، ولنفس
 *    السبب: الدفع عند الاستلام، فالبيع لا يصير مالاً إلا بالتسليم. طلب
 *    واتساب يُسجَّل `confirmed`، فلا يدخل الربح حتى تُعلِن تسليمه. لذلك
 *    نعرض بجانبه عدد المؤكَّدة غير المسلَّمة، حتى لا يبدو أن بيعاً اختفى.
 *
 * 2) **للتوصيل رقمان لا واحد.** `delivery_fee` ما يدفعه الزبون (إيراد)،
 *    و`actual_delivery_cost` ما ندفعه لشركة التوصيل (مصروف). صافي أثرهما
 *    يدخل الربح النهائي، لكن **على الطلبات التي سُجِّلت تكلفتها وحدها**:
 *    طلب بـactual_delivery_cost = NULL يُعَدّ ويُعرَض عدده، ولا يدخل أي
 *    مجموع كأنه صفر. انظر lib/orders/deliveryCost.ts.
 *
 * 3) **التكلفة الناقصة تُعَدّ ولا تُخمَّن.** منتج بلا ثمن شراء يُحتسَب
 *    بصفر، فيبدو ربحه كامل ثمن البيع. نعدّ تلك الطلبات ونعرض عددها بدل
 *    رقم ربح واثق وكاذب.
 *
 * وملاحظة تنفيذية دفعنا ثمنها: الـCTE مكتوب هنا كاملاً بدل استدعاء
 * orderCogsCte() المشترك. تركيب شظية داخل استعلام يحمل هو نفسه معاملات كان
 * يُسقط الصفحة بـ500 بعد نحو 11 ثانية على Preview — بينما بقية دوال هذا
 * الملف تستعمل الشظية إما بلا معاملات إطلاقاً أو بمعامل واحد. التكرار هنا
 * مقصود ومحدود، وأرخص من صفحة تقارير تسقط.
 */
export type SalesBySourceRow = {
  source: string;
  deliveredOrders: number;
  revenueMad: number;
  /** التوصيل المحصَّل من الزبائن — كل الطلبات المسلَّمة. إيراد. */
  deliveryFeesMad: number;
  /**
   * تكلفة التوصيل الفعلية **المسجَّلة** وحدها. الطلبات التي
   * actual_delivery_cost = NULL غائبة عن هذا المجموع تماماً — لا تدخله
   * كأصفار، لأن «غير مسجَّلة» ليست «لم تكلّفنا شيئاً».
   */
  deliveryCostRecordedMad: number;
  /**
   * التوصيل المحصَّل من الطلبات **التي لها تكلفة مسجَّلة** وحدها.
   *
   * موجود لسبب واحد: أن يكون صافي أثر التوصيل طرحاً بين مجموعتين
   * متطابقتين. لو طرحنا التكلفة المسجَّلة من كامل المحصَّل، لأدخلنا إيراد
   * طلبات لا نعرف تكلفتها وأظهرنا فائضاً وهمياً — وهو بالضبط التضليل الذي
   * وُجد هذا العمود كلّه لمنعه.
   */
  deliveryFeesOnCostedMad: number;
  /** صافي أثر التوصيل = المحصَّل − التكلفة، على الطلبات المسجَّلة وحدها. */
  deliveryNetMad: number;
  /** طلبات مسلَّمة بلا تكلفة توصيل مسجَّلة — تُعَدّ ولا تُخمَّن. */
  ordersMissingDeliveryCost: number;
  /** التوصيل المحصَّل من تلك الطلبات — إيراد مقابله تكلفة مجهولة. */
  deliveryFeesMissingCostMad: number;
  cogsMad: number;
  grossProfitMad: number;
  /** طلبات مسلَّمة ينقص أحد سطورها ثمن الشراء — ربحها مبالَغ فيه. */
  ordersWithMissingCost: number;
  /** مؤكَّدة/قيد التجهيز ولم تُسلَّم بعد: مبيعات قادمة لا تدخل الربح. */
  pendingOrders: number;
  pendingRevenueMad: number;
};

export type SalesBySource = {
  rows: SalesBySourceRow[];
  totals: Omit<SalesBySourceRow, "source">;
};

const numeric = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function getSalesBySource(
  range: { from: Date; to: Date },
  source: string | null = null
): Promise<SalesBySource> {
  // التصفية بالمصدر تقع بعد الاستعلام لا داخله. الاستعلام يُجمِّع على
  // o.source فلا يُرجع أكثر من صفّ لكل مصدر (خمسة على الأكثر)، فلا شيء
  // يُوفَّر بتصفيتها في SQL. وقد كلّفنا الفلتر داخل الاستعلام صفحة تقارير
  // معلَّقة على Preview؛ إخراجه أبسط وأسرع وأقلّ مفاجأة.
  const rows = await sql<Record<string, unknown>[]>`
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
    select
      o.source,
      count(*) filter (where o.status = 'delivered')::int                        as delivered_orders,
      coalesce(sum(o.items_subtotal) filter (where o.status = 'delivered'), 0)   as revenue,
      coalesce(sum(o.delivery_fee)   filter (where o.status = 'delivered'), 0)   as delivery_fees,
      -- التكلفة المسجَّلة وحدها: شرط is not null هو ما يمنع طلباً بلا
      -- تكلفة من أن يُحتسَب صفراً داخل SUM.
      coalesce(sum(o.actual_delivery_cost) filter (
        where o.status = 'delivered' and o.actual_delivery_cost is not null
      ), 0)                                                                      as delivery_cost_recorded,
      coalesce(sum(coalesce(o.delivery_fee, 0)) filter (
        where o.status = 'delivered' and o.actual_delivery_cost is not null
      ), 0)                                                                      as delivery_fees_on_costed,
      count(*) filter (
        where o.status = 'delivered' and o.actual_delivery_cost is null
      )::int                                                                     as orders_missing_delivery_cost,
      coalesce(sum(coalesce(o.delivery_fee, 0)) filter (
        where o.status = 'delivered' and o.actual_delivery_cost is null
      ), 0)                                                                      as delivery_fees_missing_cost,
      coalesce(sum(oc.cogs)          filter (where o.status = 'delivered'), 0)   as cogs,
      coalesce(sum(o.items_subtotal - coalesce(oc.cogs, 0)) filter (
        where o.status = 'delivered'
      ), 0)                                                                      as gross_profit,
      count(*) filter (
        where o.status = 'delivered' and coalesce(oc.has_full_snapshot, true) = false
      )::int                                                                     as missing_cost,
      count(*) filter (where o.status in ('new', 'confirmed', 'preparing', 'shipped'))::int
                                                                                 as pending_orders,
      coalesce(sum(o.items_subtotal) filter (
        where o.status in ('new', 'confirmed', 'preparing', 'shipped')
      ), 0)                                                                      as pending_revenue
    from public.orders o
    left join order_cogs oc on oc.order_id = o.id
    where o.created_at >= ${range.from} and o.created_at < ${range.to}
    group by o.source
    order by revenue desc
  `;

  const all: SalesBySourceRow[] = rows.map((r) => ({
    source: String(r.source),
    deliveredOrders: numeric(r.delivered_orders),
    revenueMad: numeric(r.revenue),
    deliveryFeesMad: numeric(r.delivery_fees),
    deliveryCostRecordedMad: numeric(r.delivery_cost_recorded),
    deliveryFeesOnCostedMad: numeric(r.delivery_fees_on_costed),
    deliveryNetMad:
      numeric(r.delivery_fees_on_costed) - numeric(r.delivery_cost_recorded),
    ordersMissingDeliveryCost: numeric(r.orders_missing_delivery_cost),
    deliveryFeesMissingCostMad: numeric(r.delivery_fees_missing_cost),
    cogsMad: numeric(r.cogs),
    grossProfitMad: numeric(r.gross_profit),
    ordersWithMissingCost: numeric(r.missing_cost),
    pendingOrders: numeric(r.pending_orders),
    pendingRevenueMad: numeric(r.pending_revenue),
  }));

  const mapped = source === null ? all : all.filter((row) => row.source === source);

  const totals = mapped.reduce<Omit<SalesBySourceRow, "source">>(
    (sum, row) => ({
      deliveredOrders: sum.deliveredOrders + row.deliveredOrders,
      revenueMad: sum.revenueMad + row.revenueMad,
      deliveryFeesMad: sum.deliveryFeesMad + row.deliveryFeesMad,
      deliveryCostRecordedMad: sum.deliveryCostRecordedMad + row.deliveryCostRecordedMad,
      deliveryFeesOnCostedMad: sum.deliveryFeesOnCostedMad + row.deliveryFeesOnCostedMad,
      deliveryNetMad: sum.deliveryNetMad + row.deliveryNetMad,
      ordersMissingDeliveryCost: sum.ordersMissingDeliveryCost + row.ordersMissingDeliveryCost,
      deliveryFeesMissingCostMad: sum.deliveryFeesMissingCostMad + row.deliveryFeesMissingCostMad,
      cogsMad: sum.cogsMad + row.cogsMad,
      grossProfitMad: sum.grossProfitMad + row.grossProfitMad,
      ordersWithMissingCost: sum.ordersWithMissingCost + row.ordersWithMissingCost,
      pendingOrders: sum.pendingOrders + row.pendingOrders,
      pendingRevenueMad: sum.pendingRevenueMad + row.pendingRevenueMad,
    }),
    {
      deliveredOrders: 0,
      revenueMad: 0,
      deliveryFeesMad: 0,
      deliveryCostRecordedMad: 0,
      deliveryFeesOnCostedMad: 0,
      deliveryNetMad: 0,
      ordersMissingDeliveryCost: 0,
      deliveryFeesMissingCostMad: 0,
      cogsMad: 0,
      grossProfitMad: 0,
      ordersWithMissingCost: 0,
      pendingOrders: 0,
      pendingRevenueMad: 0,
    }
  );

  return { rows: mapped, totals };
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

/**
 * أقدم يوم محلي فيه طلب مسجَّل — أو null إن لم يُسجَّل أي طلب بعد.
 *
 * للعرض وحده: تقول للمدير من أي يوم فعلاً يبدأ مدى «منذ البداية» بدل أن
 * يقرأ تاريخاً ثابتاً لا معنى له. أرقام التقرير **لا** تمرّ من هنا إطلاقاً
 * (انظر ALL_TIME_START_DAY في lib/analytics/dateRange.ts)، فتعذُّر هذه
 * القراءة يُخفي سطر التوضيح ولا يُنقص درهماً واحداً من أي مجموع.
 *
 * بلا فلترة حالة عمداً: هذا حدّ المدى لا حسابُ ربح. الطلب الملغى يوسّع
 * المدى ولا يدخل أي مجموع — الاستثناء يبقى حيث هو، داخل كل استعلام
 * (`where o.status = 'delivered'`). ولو قصرناه على المسلَّمة لبدأ المدى
 * بعد أول طلب فعلي، فيقول للمدير بداية ليست البداية.
 *
 * التوقيت: التحويل إلى توقيت المغرب يقع في SQL بنفس REPORT_TIME_ZONE الذي
 * تستعمله بقية الصفحة، فلا ينحرف اليوم المعروض بساعة عن اليوم المحسوب.
 */
export async function getEarliestOrderDay(): Promise<string | null> {
  const [row] = await sql<{ day: string | null }[]>`
    select to_char(
             min(created_at) at time zone ${REPORT_TIME_ZONE},
             'YYYY-MM-DD'
           ) as day
    from public.orders
  `;
  return row?.day ?? null;
}

/**
 * قُمع الزائر من الإعلان إلى الطلب المُسلَّم، مرحلةً مرحلة.
 *
 * ## لماذا هذا التقرير
 *
 * قبله لم يكن أحد يرى أين ينكسر المسار. وكل قرار في الحملة كان يُبنى على
 * أرقام Meta وحدها — وهي تعرف الزيارة والسلّة، ولا تعرف أبداً أن الطلب
 * الذي أبلغت عنه لم يُؤكَّد ثم أُلغي. فالمراحل الأولى تُقرأ من
 * `analytics_events` (قياسنا، لا Meta)، والأخيرة من `orders` نفسها.
 *
 * ## حدّان مُعلَنان
 *
 * - المراحل حتى `order_submitted` تُعدّ **جلسات مميّزة** لا أحداثاً:
 *   الزبون يضيف خمس قطع فتُسجَّل خمسة `add_to_cart`، وعدّها كخمسة يجعل
 *   "نسبة التحويل" بلا معنى. (118 حدثاً من 46 جلسة في حملة واحدة.)
 * - `adOnly` يقصر القياس على الجلسات التي تحمل مُعرّف نقرة إعلانية
 *   (`has_click_id`). بدونها يختلط ترافيك الإعلان بالمباشر والعضوي،
 *   فيبدو القُمع أفضل أو أسوأ مما هو لأسباب لا علاقة لها بالإعلان.
 */
export type FunnelStage = {
  key: string;
  label: string;
  /** جلسات مميّزة (المراحل السلوكية) أو عدد طلبات (المراحل التجارية). */
  count: number;
  /** نسبة التحويل من المرحلة السابقة، أو null للمرحلة الأولى. */
  fromPreviousPct: number | null;
  /** نسبة البقاء من أول مرحلة. */
  fromTopPct: number | null;
};

export type FunnelReport = {
  stages: FunnelStage[];
  cancellations: { reason: string; orders: number; valueMad: string }[];
  cancelledTotal: number;
};

export async function getFunnelReport(
  range: { from: Date; to: Date },
  adOnly: boolean
): Promise<FunnelReport> {
  // جلسات مميّزة لكل حدث سلوكي. `filter` بدل استعلام لكل مرحلة: مسحٌ واحد
  // على نافذة واحدة بدل تسعة.
  const [behaviour] = await sql<
    {
      lpv: number;
      atc: number;
      checkout: number;
      submitted: number;
      confirm_wa: number;
    }[]
  >`
    select
      count(distinct session_id) filter (where event_name = 'landing_page_view')::int as lpv,
      count(distinct session_id) filter (where event_name = 'add_to_cart')::int as atc,
      count(distinct session_id) filter (where event_name = 'begin_checkout')::int as checkout,
      count(distinct session_id) filter (where event_name = 'order_submitted')::int as submitted,
      count(distinct session_id) filter (where event_name = 'confirm_on_whatsapp')::int as confirm_wa
    from public.analytics_events
    where occurred_at >= ${range.from} and occurred_at < ${range.to}
      and (${adOnly} = false or has_click_id)
  `;

  // المراحل التجارية من الطلبات: الحالة الحاضرة لا تكفي (طلب مُسلَّم مرّ
  // بـconfirmed قطعاً)، فنقرأ "وصل إلى" من سجل الحالات مع الحالة الحالية.
  const [commercial] = await sql<
    { contacted: number; confirmed: number; shipped: number; delivered: number; cancelled: number }[]
  >`
    with o as (
      select id, status from public.orders
      where created_at >= ${range.from} and created_at < ${range.to}
        and source = 'website'
    ),
    reached as (
      select o.id,
        bool_or(h.status = 'contacted') as ever_contacted,
        bool_or(h.status in ('confirmed','preparing','shipped','delivered')) as ever_confirmed,
        bool_or(h.status in ('shipped','delivered')) as ever_shipped,
        bool_or(h.status = 'delivered') as ever_delivered,
        bool_or(h.status = 'cancelled') as ever_cancelled
      from o left join public.order_status_history h on h.order_id = o.id
      group by o.id
    )
    select
      count(*) filter (where ever_contacted)::int as contacted,
      count(*) filter (where ever_confirmed)::int  as confirmed,
      count(*) filter (where ever_shipped)::int    as shipped,
      count(*) filter (where ever_delivered)::int  as delivered,
      count(*) filter (where ever_cancelled)::int  as cancelled
    from reached
  `;

  const cancellations = await sql<{ reason: string; orders: number; value_mad: string }[]>`
    select
      coalesce(cancellation_reason, 'غير محدَّد') as reason,
      count(*)::int as orders,
      coalesce(sum(items_subtotal), 0)::text as value_mad
    from public.orders
    where created_at >= ${range.from} and created_at < ${range.to}
      and status = 'cancelled'
    group by 1
    order by orders desc
  `;

  const raw: { key: string; label: string; count: number }[] = [
    { key: "lpv", label: "وصلوا الموقع", count: behaviour?.lpv ?? 0 },
    { key: "atc", label: "زادوا في السلة", count: behaviour?.atc ?? 0 },
    { key: "checkout", label: "بدأوا إتمام الطلب", count: behaviour?.checkout ?? 0 },
    { key: "submitted", label: "أرسلوا الطلب", count: behaviour?.submitted ?? 0 },
    { key: "confirm_wa", label: "ضغطوا تأكيد واتساب", count: behaviour?.confirm_wa ?? 0 },
    { key: "contacted", label: "تواصلنا معهم", count: commercial?.contacted ?? 0 },
    { key: "confirmed", label: "أكّدوا الطلب", count: commercial?.confirmed ?? 0 },
    { key: "shipped", label: "أُرسلت", count: commercial?.shipped ?? 0 },
    { key: "delivered", label: "سُلّمت", count: commercial?.delivered ?? 0 },
  ];

  const top = raw[0]?.count ?? 0;
  const stages: FunnelStage[] = raw.map((stage, index) => {
    const previous = index === 0 ? null : raw[index - 1].count;
    return {
      ...stage,
      // صفر في المرحلة السابقة لا يعني 0% ولا 100% — لا نسبة له أصلاً.
      fromPreviousPct:
        previous === null || previous === 0 ? null : (stage.count / previous) * 100,
      fromTopPct: top === 0 ? null : (stage.count / top) * 100,
    };
  });

  return {
    stages,
    cancellations: cancellations.map((row) => ({
      reason: row.reason,
      orders: row.orders,
      valueMad: row.value_mad,
    })),
    cancelledTotal: commercial?.cancelled ?? 0,
  };
}
