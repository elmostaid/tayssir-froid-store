-- لقطة داخل القاعدة قبل الـmigration مباشرة — طبقة استرجاع سريعة.
--
-- لا تُغني عن النسخة الخارجية (backup-production-db.sh): الخطة المجانية في
-- Supabase بلا نسخ يومية تلقائية، وهذه اللقطة تعيش في نفس القاعدة. لكنها
-- تُسترجع في ثوانٍ لو احتجنا جدولاً بعينه، بلا توقّف المشروع كله.
--
-- مخطَّط منفصل غير مكشوف لـPostgREST، ومسحوب الصلاحيات من anon/authenticated.
-- يُحذف بعد 14 يوماً من نشر ناجح (`drop schema backup_pre_tracking cascade`).
set lock_timeout = '5s';
create schema backup_pre_tracking;
revoke all on schema backup_pre_tracking from public, anon, authenticated;

create table backup_pre_tracking.orders as table public.orders;
create table backup_pre_tracking.order_items as table public.order_items;
create table backup_pre_tracking.order_status_history as table public.order_status_history;
create table backup_pre_tracking.stock_movements as table public.stock_movements;
create table backup_pre_tracking.whatsapp_leads as table public.whatsapp_leads;
create table backup_pre_tracking.products as table public.products;
create table backup_pre_tracking.settings as table public.settings;
create table backup_pre_tracking.analytics_events as table public.analytics_events;

-- تعريفات ما تُعدّله الـmigrations حرفياً، لاسترجاعه كما كان.
create table backup_pre_tracking.definitions as
  select 'function:set_updated_at' as name, pg_get_functiondef('public.set_updated_at()'::regprocedure) as def
  union all
  select 'constraint:analytics_events_event_name_check',
         pg_get_constraintdef(oid) from pg_constraint where conname = 'analytics_events_event_name_check';

select 'snapshot' as step, (select count(*) from backup_pre_tracking.orders) as orders,
       (select count(*) from backup_pre_tracking.analytics_events) as analytics_events;
reset lock_timeout;
