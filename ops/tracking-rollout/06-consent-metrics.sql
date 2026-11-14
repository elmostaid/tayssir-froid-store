-- نسبة الموافقة وأثرها على Purchase — قراءة فقط.

-- 1) نسبة الموافقة اليومية (من شريط الموافقة، القياس الداخلي أول طرف).
--    "لم يُجب" = جلسات جديدة بلا اختيار (تقدير: session_start ناقص الاختيارات).
with d as (
  select (occurred_at at time zone 'Africa/Casablanca')::date as day,
         count(*) filter (where event_name = 'ad_consent_granted') as granted,
         count(*) filter (where event_name = 'ad_consent_denied') as denied,
         count(*) filter (where event_name = 'session_start') as sessions
  from public.analytics_events
  where occurred_at > now() - interval '30 days'
  group by 1
)
select day, sessions, granted, denied,
       round(100.0 * granted / nullif(granted + denied, 0), 1) as consent_rate_pct,
       round(100.0 * (granted + denied) / nullif(sessions, 0), 1) as answered_pct
from d order by day desc;

-- 2) نفس النسبة لزوار الإعلانات وحدهم (الجلسة القادمة من حملة).
select s.utm_campaign,
       count(distinct c.session_id) filter (where c.event_name = 'ad_consent_granted') as granted,
       count(distinct c.session_id) filter (where c.event_name = 'ad_consent_denied') as denied
from public.analytics_events c
join public.analytics_events s on s.session_id = c.session_id and s.event_name = 'session_start'
where c.event_name in ('ad_consent_granted', 'ad_consent_denied')
  and c.occurred_at > now() - interval '30 days'
group by 1 order by 2 desc nulls last;

-- 3) الأثر على Purchase: طلبيات الموقع المؤكَّدة حسب الموافقة.
--    "بلا موافقة" = بيعات حقيقية لن تعرفها Meta — هذا هو ثمن الامتثال، يُقاس لا يُخمَّن.
select ad_consent,
       count(*) as confirmed_website_orders,
       count(*) filter (where meta_purchase_accepted_at is not null) as sent_to_meta,
       round(sum(items_subtotal)) as value_mad
from public.orders
where source = 'website'
  and status in ('confirmed','preparing','shipped','delivered')
  and created_at > now() - interval '30 days'
group by 1 order by 2 desc;

-- 4) قبل/بعد: Purchase المقبولة أسبوعياً (خطّ الأساس = الأسابيع قبل النشر).
select date_trunc('week', meta_purchase_accepted_at at time zone 'Africa/Casablanca')::date as week,
       count(*) as purchases_accepted
from public.orders
where meta_purchase_accepted_at > now() - interval '10 weeks'
group by 1 order by 1 desc;
