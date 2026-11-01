-- التراجع عن الـmigrations الثلاث — **فقط** إن لزم بعد التراجع عن الكود.
--
-- عادةً لا حاجة له: الـmigrations إضافية، وكود الإنتاج السابق (5bc6dca)
-- يجتاز 1177/1177 اختباراً فوقها. يُستعمل إن قرّرنا إزالة الميزة كلياً.
--
-- يجب أن يسبقه التراجع عن الكود (Vercel Instant Rollback): الكود الجديد
-- يقرأ هذه الأعمدة، وحذفها تحته يكسر الطلبيات.
--
-- يحذف بيانات الميزة الجديدة نفسها (الاستفسارات، والموافقات المسجَّلة) —
-- خذ نسخة منها أولاً إن كانت تهمّ.
set lock_timeout = '5s';

-- 3) أحداث الموافقة: تُحذف صفوفها ثم يعود القيد كما كان.
delete from public.analytics_events where event_name in ('ad_consent_granted', 'ad_consent_denied');
alter table public.analytics_events drop constraint analytics_events_event_name_check;
alter table public.analytics_events add constraint analytics_events_event_name_check check (
  event_name = any (array[
    'session_start'::text, 'landing_page_view'::text, 'product_view'::text, 'add_to_cart'::text,
    'cart_view'::text, 'begin_checkout'::text, 'whatsapp_from_cart'::text, 'order_submitted'::text,
    'confirm_on_whatsapp'::text, 'purchase'::text
  ])
);

-- 2) المُشغّل كما كان حرفياً، والمحو يُحذف.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
drop function if exists public.purge_expired_tracking_identity(integer);

-- 1) الجدول والأعمدة الجديدة.
drop table if exists public.whatsapp_inquiries;
drop index if exists public.orders_origin_reference_idx;
alter table public.orders
  drop column if exists origin_reference,
  drop column if exists ad_consent,
  drop column if exists ad_consent_source,
  drop column if exists meta_purchase_action_source;
alter table public.whatsapp_leads drop constraint if exists whatsapp_leads_identity_needs_consent;
alter table public.whatsapp_leads
  drop column if exists capi_identity,
  drop column if exists ad_consent;

reset lock_timeout;
