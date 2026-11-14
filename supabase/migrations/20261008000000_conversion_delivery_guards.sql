-- تسليم البيعة: إثباتٌ لا ظنّ، ومحاولةٌ ثانية لا خسارة صامتة.
--
-- الترحيل السابق نقل Purchase إلى لحظة التأكيد وحرسه بـ
-- `meta_purchase_sent_at`. وأول بيعة حقيقية مرّت عليه (الطلب 177) كشفت أن
-- الحرس يُؤخَذ **قبل** النداء: فلو فشل الاتصال بـMeta لبقي الحرس مستهلكاً
-- ولا يُعاد المحاولة أبداً، ولا سطر عندنا يقول هل قبلت Meta الحدث أصلاً.
-- أي أننا كنّا نحتسب "أُرسل" بمعنى "حاولنا".
--
-- فهنا ثلاثة أعمدة تفصل الثلاثة: المحاولة (attempts)، القبول المُثبَت من
-- جواب Meta (accepted_at)، وسبب آخر فشل (error). ومعها حرسٌ مستقلّ لـGA4 —
-- GA4 **لا تُلغي تكرار purchase حسب transaction_id**، فبيعةٌ تُرسَل مرتين
-- تصير إيراداً مضاعفاً، ولا يحرسها إلا عمودٌ عندنا.

alter table public.orders
  add column if not exists meta_purchase_attempts integer not null default 0,
  add column if not exists meta_purchase_error text,
  add column if not exists meta_purchase_accepted_at timestamptz,
  add column if not exists ga_identity jsonb,
  add column if not exists ga_purchase_sent_at timestamptz,
  add column if not exists ga_purchase_attempts integer not null default 0;

comment on column public.orders.meta_purchase_attempts is
  'عدد محاولات إرسال Purchase إلى Meta. سقفٌ في الكود يمنع التكرار اللانهائي.';
comment on column public.orders.meta_purchase_error is
  'سبب آخر فشل. غير فارغ = بيعة مؤكَّدة لم تصل Meta بعد، وتحتاج إعادة محاولة.';
comment on column public.orders.meta_purchase_accepted_at is
  'لحظة تأكيد Meta استلام الحدث (events_received ≥ 1) — لا لحظة إرسالنا.';
comment on column public.orders.ga_identity is
  'لقطة هوية GA4 من متصفح الزبون لحظة الطلب: client_id وsession_id من كوكيّي _ga.';
comment on column public.orders.ga_purchase_sent_at is
  'حرس exactly-once لشراء GA4 — GA4 لا تُلغي التكرار حسب transaction_id.';

-- القبول المُثبَت بأثر رجعي: فقط الطلبات التي لها حدث `purchase` داخلي
-- فعلاً (المسار القديم: المتصفح + CAPI بنفس event_id). ما عداها يبقى
-- accepted_at فارغاً — "لا نعرف" أصدق من "نعم".
update public.orders o
set meta_purchase_accepted_at = e.occurred_at
from public.analytics_events e
where e.order_id = o.id
  and e.event_name = 'purchase'
  and o.meta_purchase_accepted_at is null;

-- حرس GA4 بأثر رجعي، وهو ضروري بنفس درجة حرس Meta: بدونه أول تغيير حالة
-- على أي طلب قديم يُرسل شراء GA4 ثانياً لبيعة أُرسلت عند الإرسال أصلاً.
--
-- المعيار هو حرس Meta نفسه: كل طلب محروسٌ لـMeta محروسٌ لـGA4. وهذا يترك
-- بقصدٍ الطلبات التي لم تُحسم بعد (طلب موقع ينتظر المراجعة أو التأكيد)
-- حرّةً لترسل شراءها **عند التأكيد** كما يجب — وهي الحالة التي من أجلها
-- نقلنا الحدث من لحظة الإرسال.
update public.orders
set ga_purchase_sent_at = coalesce(confirmed_at, created_at)
where ga_purchase_sent_at is null
  and meta_purchase_sent_at is not null;
