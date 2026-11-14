-- بعد الـmigrations: كل ما يحتاجه الكود الجديد موجود، والقديم لم يتغيّر. قراءة فقط.
select
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='whatsapp_inquiries') as inquiries_table,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='orders'
     and column_name in ('origin_reference','ad_consent','ad_consent_source','meta_purchase_action_source')) = 4 as order_columns,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='whatsapp_leads'
     and column_name in ('capi_identity','ad_consent')) = 2 as lead_columns,
  exists(select 1 from pg_proc where proname='purge_expired_tracking_identity') as purge_function,
  position('keep_updated_at' in pg_get_functiondef('public.set_updated_at()'::regprocedure)) > 0 as trigger_guard,
  pg_get_constraintdef((select oid from pg_constraint where conname='analytics_events_event_name_check')) like '%ad_consent_granted%' as consent_events,
  (select count(*) from public.orders where ad_consent <> 'unknown') = 0 as no_retroactive_consent,
  (select relrowsecurity from pg_class where oid = 'public.whatsapp_inquiries'::regclass) as inquiries_rls;
