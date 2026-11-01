-- قياس نسبة الموافقة على التتبّع — في القياس الداخلي، لا عند طرف ثالث.
--
-- بدون هذا لا نعرف كم زائراً رفض، فلا نعرف كم بيعةً لن تصل Meta بسبب
-- الموافقة لا بسبب عطل. حدثان فقط، بلا أي حقل إضافي: الاختيار نفسه، في
-- جلسة القياس الداخلي القائمة (`tf_sid`، أول طرف، بلا معرّف إعلاني).
--
-- الجدول ~53 ألف صفّ في الإنتاج: إعادة القيد تمسحه مرة واحدة تحت قفل
-- لحظي. `lock_timeout` يمنع الانتظار خلف معاملة طويلة؛ الفشل هنا آمن.
set lock_timeout = '5s';

alter table public.analytics_events drop constraint analytics_events_event_name_check;
alter table public.analytics_events add constraint analytics_events_event_name_check check (
  event_name = any (array[
    'session_start'::text,
    'landing_page_view'::text,
    'product_view'::text,
    'add_to_cart'::text,
    'cart_view'::text,
    'begin_checkout'::text,
    'whatsapp_from_cart'::text,
    'order_submitted'::text,
    'confirm_on_whatsapp'::text,
    'purchase'::text,
    'ad_consent_granted'::text,
    'ad_consent_denied'::text
  ])
);

reset lock_timeout;
