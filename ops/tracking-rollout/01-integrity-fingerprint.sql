-- بصمة سلامة البيانات — قراءة فقط. تُشغَّل قبل الـmigration وبعدها مباشرة،
-- والنتيجتان يجب أن تتطابقا حرفياً: الـmigration تضيف أعمدة وجداول، ولا
-- تمسّ صفاً قائماً.
--
-- لا تُظهر أي بيانات زبون: عدد الصفوف، وأكبر معرّف، ومجموع بصمات الصفوف
-- (hashtextextended) — رقم واحد لكل جدول. الأعمدة الجديدة تُستثنى من البصمة
-- (`jsonb - array[...]`)، فالبصمة قبلها وبعدها قابلة للمقارنة.
select t, n, max_id, h from (
  select 'orders' t, count(*) n, max(id) max_id,
    sum(hashtextextended((to_jsonb(o) - array['origin_reference','ad_consent','ad_consent_source','meta_purchase_action_source'])::text, 0)) h
  from public.orders o
  union all select 'order_items', count(*), max(id), sum(hashtextextended(to_jsonb(x)::text, 0)) from public.order_items x
  union all select 'order_status_history', count(*), max(id), sum(hashtextextended(to_jsonb(x)::text, 0)) from public.order_status_history x
  union all select 'stock_movements', count(*), max(id), sum(hashtextextended(to_jsonb(x)::text, 0)) from public.stock_movements x
  union all select 'products', count(*), max(id), sum(hashtextextended(to_jsonb(x)::text, 0)) from public.products x
  union all select 'whatsapp_leads', count(*), max(id),
    sum(hashtextextended((to_jsonb(x) - array['capi_identity','ad_consent'])::text, 0)) from public.whatsapp_leads x
  union all select 'analytics_events', count(*), max(id), sum(hashtextextended(to_jsonb(x)::text, 0)) from public.analytics_events x
  union all select 'operating_expenses', count(*), max(id), sum(hashtextextended(to_jsonb(x)::text, 0)) from public.operating_expenses x
  union all select 'order_deletions', count(*), max(id), sum(hashtextextended(to_jsonb(x)::text, 0)) from public.order_deletions x
  union all select 'settings', count(*), null, sum(hashtextextended(to_jsonb(x)::text, 0)) from public.settings x
) f order by t;
