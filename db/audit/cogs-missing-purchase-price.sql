-- =====================================================================
-- فحص READ-ONLY لقاعدة Production — لا UPDATE ولا INSERT ولا DELETE.
-- سطور الطلبات المسلَّمة التي تكلفتها مفقودة أو محسوبة بصفر.
--
-- التعريف مأخوذ حرفياً من التقرير نفسه (src/lib/queries/adminReports.ts):
--   تكلفة الوحدة = coalesce(oi.purchase_price_snapshot,
--                            pv.purchase_price_override,
--                            p.purchase_price, 0)
-- فالسطر لا يضخّم الربح إلا حين تنتهي هذه السلسلة إلى صفر.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) التفصيل: كل سطر مسلَّم بتكلفة صفر أو بلا snapshot
-- ─────────────────────────────────────────────────────────────────────
with line_cost as (
  select
    o.order_number,
    o.created_at,
    o.status,
    oi.product_name_snapshot                      as product_name,
    oi.sku_snapshot                               as sku,
    oi.quantity,
    oi.unit_price_snapshot::numeric               as unit_sale_price,
    oi.line_total::numeric                        as line_revenue,
    oi.purchase_price_snapshot::numeric           as snapshot_now,
    oi.line_status,
    oi.product_id,
    coalesce(
      oi.purchase_price_snapshot,
      pv.purchase_price_override,
      p.purchase_price,
      0
    )::numeric                                    as effective_unit_cost,
    p.purchase_price::numeric                     as current_product_purchase_price,
    case
      when o.created_at >= current_date - interval '6 days' then 'آخر 7 أيام'
      when o.created_at >= date_trunc('month', current_date) then 'الشهر الحالي (قبل آخر 7 أيام)'
      else 'أقدم'
    end                                           as period
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.products p on p.id = oi.product_id
  left join public.product_variants pv on pv.id = oi.variant_id
  where o.status = 'delivered'
)
select
  period,
  order_number                                    as "رقم الطلب",
  created_at                                      as "تاريخ الطلب",
  product_name                                    as "اسم المنتج",
  sku                                             as "SKU",
  quantity                                        as "الكمية",
  unit_sale_price                                 as "ثمن البيع للوحدة",
  snapshot_now                                    as "purchase_price_snapshot الحالي",
  current_product_purchase_price                  as "ثمن الشراء الحالي للمنتج",
  effective_unit_cost                             as "التكلفة المستعملة فعلياً",
  line_revenue                                    as "قيمة مبيعات السطر",
  -- التقرير يحسب تكلفة هذا السطر = quantity × effective_unit_cost.
  -- حين تكون صفراً، الربح المعروض يزيد بقيمة السطر كاملةً.
  round(line_revenue - (quantity * effective_unit_cost), 2)
                                                  as "الربح المعروض لهذا السطر",
  case
    when effective_unit_cost <= 0
      then round(line_revenue, 2)
    else 0
  end                                             as "تضخيم الربح (الحد الأقصى)",
  case
    when product_id is null then 'المنتج محذوف — لا مصدر لثمن الشراء إطلاقاً'
    when effective_unit_cost <= 0 and snapshot_now is null
      then 'لا snapshot ولا ثمن شراء حالي — تكلفة صفر'
    when effective_unit_cost <= 0 and snapshot_now = 0
      then 'snapshot مسجَّل بصفر'
    when snapshot_now is null
      then 'لا snapshot — التقرير يستعمل ثمن الشراء الحالي كتقدير تاريخي'
    else 'سليم'
  end                                             as "التشخيص",
  line_status                                     as "حالة السطر"
from line_cost
where effective_unit_cost <= 0 or snapshot_now is null
order by
  case period when 'آخر 7 أيام' then 1 when 'الشهر الحالي (قبل آخر 7 أيام)' then 2 else 3 end,
  created_at desc,
  sku;


-- ─────────────────────────────────────────────────────────────────────
-- 2) الملخّص حسب الفترة والخطورة
-- ─────────────────────────────────────────────────────────────────────
with line_cost as (
  select
    o.created_at,
    oi.quantity,
    oi.line_total::numeric as line_revenue,
    oi.purchase_price_snapshot as snapshot_now,
    coalesce(oi.purchase_price_snapshot, pv.purchase_price_override, p.purchase_price, 0)::numeric
      as effective_unit_cost
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.products p on p.id = oi.product_id
  left join public.product_variants pv on pv.id = oi.variant_id
  where o.status = 'delivered'
),
bucketed as (
  select 'آخر 7 أيام' as period, 1 as ord, * from line_cost
    where created_at >= current_date - interval '6 days'
  union all
  select 'الشهر الحالي', 2, * from line_cost
    where created_at >= date_trunc('month', current_date)
  union all
  select 'كل الطلبات المسلَّمة', 3, * from line_cost
)
select
  period                                                        as "الفترة",
  count(*)                                                      as "عدد السطور",
  count(*) filter (where effective_unit_cost <= 0)              as "سطور بتكلفة صفر",
  count(*) filter (where snapshot_now is null and effective_unit_cost > 0)
                                                                as "سطور بتقدير تاريخي",
  round(sum(line_revenue), 2)                                   as "مبيعات السطور",
  round(sum(quantity * effective_unit_cost), 2)                 as "التكلفة المحسوبة",
  round(sum(line_revenue - quantity * effective_unit_cost), 2)  as "الربح المعروض",
  round(sum(line_revenue) filter (where effective_unit_cost <= 0), 2)
                                                                as "تضخيم الربح (الحد الأقصى)"
from bucketed
group by period, ord
order by ord;


-- ─────────────────────────────────────────────────────────────────────
-- 3) الخلاصة: الربح المعروض الآن، وكم سيَنقص
--    (يطابق أرقام /admin/reports حرفياً — نفس الصيغة ونفس حدود الفترات)
-- ─────────────────────────────────────────────────────────────────────
with order_cogs as (
  select
    oi.order_id,
    sum(oi.quantity * coalesce(oi.purchase_price_snapshot, pv.purchase_price_override, p.purchase_price, 0)) as cogs,
    sum(oi.line_total) filter (
      where coalesce(oi.purchase_price_snapshot, pv.purchase_price_override, p.purchase_price, 0) <= 0
    ) as revenue_at_zero_cost,
    bool_and(oi.purchase_price_snapshot is not null) as has_full_snapshot
  from public.order_items oi
  left join public.products p on p.id = oi.product_id
  left join public.product_variants pv on pv.id = oi.variant_id
  group by oi.order_id
)
select
  round(coalesce(sum(o.items_subtotal - coalesce(oc.cogs, 0)), 0), 2)
    as "الربح المعروض — كل المسلَّم",
  round(coalesce(sum(o.items_subtotal - coalesce(oc.cogs, 0)) filter (
    where o.created_at >= current_date - interval '6 days'), 0), 2)
    as "الربح المعروض — آخر 7 أيام",
  round(coalesce(sum(o.items_subtotal - coalesce(oc.cogs, 0)) filter (
    where o.created_at >= date_trunc('month', current_date)), 0), 2)
    as "الربح المعروض — الشهر الحالي",
  round(coalesce(sum(oc.revenue_at_zero_cost), 0), 2)
    as "سيَنقص بحد أقصى — كل المسلَّم",
  round(coalesce(sum(oc.revenue_at_zero_cost) filter (
    where o.created_at >= current_date - interval '6 days'), 0), 2)
    as "سيَنقص بحد أقصى — آخر 7 أيام",
  round(coalesce(sum(oc.revenue_at_zero_cost) filter (
    where o.created_at >= date_trunc('month', current_date)), 0), 2)
    as "سيَنقص بحد أقصى — الشهر الحالي",
  count(*) filter (where coalesce(oc.has_full_snapshot, true) = false)
    as "طلبات بربح تقديري"
from public.orders o
left join order_cogs oc on oc.order_id = o.id
where o.status = 'delivered';
