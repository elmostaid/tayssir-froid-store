-- المحو بعد 180 يوماً لا يمسّ الطلبية — ولا حتى `updated_at`.
--
-- ## ما كشفته المراجعة
--
-- `purge_expired_tracking_identity` تُحدّث `orders` لتمحو هوية المتصفح
-- ومعرّفات النقر، ومُشغّل `orders_set_updated_at` يكتب `updated_at = now()`
-- على كل صفّ يُحدَّث. فكان المحو سيُظهر طلبيات عمرها ستة أشهر «معدَّلة اليوم»
-- — لا شيء في الكود يقرأ هذا العمود اليوم، لكن المحو وُعِد بألّا يمسّ
-- الطلبية، وطابعها الزمني جزءٌ منها.
--
-- ## الحلّ، بأضيق أثر
--
-- `set_updated_at` يحترم متغيّراً **محلياً للمعاملة** (`tf.keep_updated_at`)
-- لا تضبطه إلا دالة المحو، بـ`set_config(..., true)` فينتهي مع معاملتها.
-- كل تحديث آخر في القاعدة — كل المسارات القائمة — يمرّ كما كان حرفياً.
set lock_timeout = '5s';

create or replace function public.set_updated_at()
returns trigger as $$
begin
  if current_setting('tf.keep_updated_at', true) = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.purge_expired_tracking_identity(p_days integer default 180)
returns table(orders_purged bigint, leads_purged bigint, inquiries_purged bigint)
language plpgsql
as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  click_keys text[] := array['fbclid', 'gclid', 'ttclid'];
  o bigint; l bigint; q bigint;
begin
  -- محلي للمعاملة: ينتهي معها، ولا يراه أي اتصال آخر.
  perform set_config('tf.keep_updated_at', 'on', true);

  -- لا يُلمس إلا هذه الأعمدة الثلاثة: لا الحالة ولا المبالغ ولا السطور ولا
  -- سجلّ الحالات ولا المخزون (جداول لا تذكرها هذه الدالة أصلاً).
  update public.orders
     set capi_identity = null,
         ga_identity = null,
         attribution_first = case when attribution_first is null then null
                                  else attribution_first - click_keys end,
         attribution_last = case when attribution_last is null then null
                                 else attribution_last - click_keys end
   where created_at < cutoff
     and (capi_identity is not null or ga_identity is not null
          or attribution_first ?| click_keys or attribution_last ?| click_keys);
  get diagnostics o = row_count;

  update public.whatsapp_leads
     set capi_identity = null,
         attribution_first = case when attribution_first is null then null
                                  else attribution_first - click_keys end,
         attribution_last = case when attribution_last is null then null
                                 else attribution_last - click_keys end
   where created_at < cutoff
     and (capi_identity is not null
          or attribution_first ?| click_keys or attribution_last ?| click_keys);
  get diagnostics l = row_count;

  update public.whatsapp_inquiries
     set capi_identity = null,
         attribution_first = case when attribution_first is null then null
                                  else attribution_first - click_keys end,
         attribution_last = case when attribution_last is null then null
                                 else attribution_last - click_keys end
   where created_at < cutoff
     and (capi_identity is not null
          or attribution_first ?| click_keys or attribution_last ?| click_keys);
  get diagnostics q = row_count;

  perform set_config('tf.keep_updated_at', 'off', true);
  return query select o, l, q;
end;
$$;

revoke all on function public.purge_expired_tracking_identity(integer) from public, anon, authenticated;

reset lock_timeout;
