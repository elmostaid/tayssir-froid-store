-- نسب الطلب إلى مصدره: من أين جاء الزبون، وبأي حملة وإعلان.
--
-- المشكلة التي يحلّها: جدول orders كان يحفظ `source` بقيمتين فقط
-- ('website' / 'whatsapp')، فيستحيل معرفة أي حملة أو إعلان جاء بالطلب. وسوم
-- الحملة كانت تُسجَّل في analytics_events وحدها، بلا أي رابط موثوق إلى الطلب.
--
-- الشكل: عمودا jsonb بدل عشرين عموداً مسطّحاً. السبب أن الحقول قد تتوسّع
-- لاحقاً (شبكة إعلانية جديدة، مُعرّف نقر جديد) وjsonb يستوعبها بلا هجرة
-- جديدة، وPostgres يقرأ منها بـ->> مباشرة في التقارير.
--
--   attribution_first  = كيف عرف الزبون الموقع أول مرة (لا يُكتب فوقه)
--   attribution_last   = آخر مصدر أدخله قبل الطلب (المعتمَد في نسب التحويل)
--
-- كلا العمودين nullable بلا default: الهجرة إضافية بحتة، لا UPDATE ولا
-- backfill، والطلبات الأربعون الموجودة تبقى كما هي بقيمة NULL تعني
-- "غير معروف" بصدق بدل قيمة مخترَعة.
--
-- ملاحظة على مُعرّفات النقر (fbclid/gclid/ttclid): القياس الداخلي في
-- analytics_events يحفظ has_click_id كقيمة منطقية فقط ولا يخزّن المُعرّف
-- إطلاقاً، لأن ذلك الجدول مجهول الهوية عمداً. هنا الأمر مختلف: صف الطلب
-- يحمل أصلاً اسم الزبون وهاتفه، والمُعرّف ضروري لنسب الإعلان ولإرسال
-- التحويلات دون اتصال (offline conversions) لاحقاً. لا يغيّر هذا شيئاً في
-- سياسة analytics_events، التي تبقى كما هي.

alter table public.orders
  add column if not exists attribution_first jsonb,
  add column if not exists attribution_last  jsonb;

comment on column public.orders.attribution_first is
  'أول لمسة: مصدر/حملة/إعلان أول دخول للزائر. NULL = غير معروف (طلبات ما قبل هذه الهجرة، أو واتساب).';
comment on column public.orders.attribution_last is
  'آخر لمسة قبل الطلب — المعتمَدة في نسب التحويل. NULL = غير معروف.';

-- فهرسان جزئيان على مفتاحَي التجميع الأكثر استعمالاً في التقارير
-- (المصدر والحملة من آخر لمسة). جزئيان لأن أغلب الصفوف القديمة NULL.
create index if not exists orders_attribution_last_source_idx
  on public.orders ((attribution_last ->> 'utmSource'))
  where attribution_last is not null;

create index if not exists orders_attribution_last_campaign_idx
  on public.orders ((attribution_last ->> 'utmCampaign'))
  where attribution_last is not null;
