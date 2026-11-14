-- مراقبة ما بعد النشر — قراءة فقط، بلا بيانات زبون. تُشغَّل في كل نقطة من
-- جدول المراقبة (T+15د، +1س، +4س، +24س، +48س) وتُقارن بخطّ الأساس (أسبوعان
-- قبل النشر، نفس الساعات).

-- 1) استقبال الطلبيات: لكل ساعة منذ النشر، مقابل نفس الساعة قبل أسبوع.
--    التحذير: صفر طلبية موقع في ساعة كانت فيها عادةً ≥1 ⇒ افحص /api/orders.
select date_trunc('hour', created_at at time zone 'Africa/Casablanca') as hour,
       count(*) filter (where source = 'website') as website_orders,
       count(*) filter (where source <> 'website') as manual_orders,
       count(*) filter (where status = 'needs_review') as needs_review
from public.orders
where created_at > now() - interval '48 hours'
group by 1 order by 1 desc;

-- 2) الطلبيات اليدوية: تُسجَّل، والمرجع لا يعرقل. originWarning يظهر في
--    سجلّ الحالة؛ نسبة عالية منه = المدير يلصق مراجع خاطئة (تدريب، لا عطل).
select count(*) as manual_orders_48h,
       count(*) filter (where o.origin_reference is not null) as linked,
       count(*) filter (where h.note like '%المرجع لم يُربط%') as reference_not_linked
from public.orders o
left join public.order_status_history h on h.order_id = o.id and h.note like '%المرجع لم يُربط%'
where o.source <> 'website' and o.created_at > now() - interval '48 hours';

-- 3) أزرار واتساب: الاستفسارات تُسجَّل (Q-) والسلات (W-).
--    صفر استفسار خلال ساعات ذروة ⇒ /api/whatsapp-inquiries يفشل (الزبون لا
--    يتأثّر: واتساب يُفتح على أي حال، لكن الإسناد يضيع).
select date_trunc('hour', created_at at time zone 'Africa/Casablanca') as hour,
       count(*) as inquiries,
       count(*) filter (where kind = 'product') as product_inquiries,
       count(*) filter (where ad_consent = 'granted') as with_consent
from public.whatsapp_inquiries
where created_at > now() - interval '48 hours'
group by 1 order by 1 desc;

select date_trunc('hour', created_at at time zone 'Africa/Casablanca') as hour, count(*) as cart_leads
from public.whatsapp_leads where created_at > now() - interval '48 hours' group by 1 order by 1 desc;

-- 4) Purchase إلى Meta (الموقع وحده؛ المبيعات الخارجية مُطفأة):
--    كل مؤكَّد بموافقة يجب أن يُقبل؛ أي "error" أو "sent بلا accepted" = عطل.
select count(*) filter (where status in ('confirmed','preparing','shipped','delivered')) as confirmed_48h,
       count(*) filter (where meta_purchase_accepted_at is not null) as purchase_accepted,
       count(*) filter (where meta_purchase_error is not null) as purchase_errors,
       count(*) filter (where meta_purchase_accepted_at is not null and source <> 'website') as offline_sent_must_be_zero
from public.orders where confirmed_at > now() - interval '48 hours';

-- 5) استقرار القاعدة: اتصالات نشطة وأطول استعلام جارٍ الآن.
select count(*) filter (where state = 'active') as active,
       count(*) filter (where state = 'idle in transaction') as idle_in_tx,
       max(now() - query_start) filter (where state = 'active') as longest_active
from pg_stat_activity where datname = current_database();
