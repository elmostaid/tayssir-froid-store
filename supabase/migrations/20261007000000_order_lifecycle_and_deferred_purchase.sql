-- دورة حياة الطلب، والإلغاء الذي يحفظ بدل أن يمحو، وشراء Meta المؤجَّل.
--
-- ## المشكلة التي يحلّها هذا الملف
--
-- طلب الموقع كان يُرسَل إلى Meta كـ`Purchase` في لحظة الإرسال. لكن البيعة
-- الحقيقية لا تولد هناك: الزبون يؤكّد في واتساب بعدها. وما لا يُؤكَّد كان
-- يُلغى ثم يُحذف من الجدول — فتبقى Meta تعرف بيعةً وقعت ولا تعرف أنها لم
-- تكتمل. القياس المقارن (analytics_events × orders × Meta) أظهر 38 حذفاً
-- مُسجَّلاً بقيمة 45,985 درهم، وتضخيماً في قيمة Meta بين 2.4× و6.0× حسب
-- الحملة. السبب ليس خطأً في Meta: الإشارة التي أرسلناها كانت مبكّرة.
--
-- ## ما يفعله هذا الملف
--
-- 1. `contacted` كحالة بين `new` و`confirmed` — ليُقاس "راسلناه ولم يجب"
--    منفصلاً عن "لم نراسله بعد". اختيارية: من يؤكّد في أول رسالة ينتقل
--    `new → confirmed` مباشرة، فلا نُجبر خطوةً لا تُفيد.
--
-- 2. `cancellation_reason` + `cancellation_note` — الإلغاء اليومي يصبح
--    `status='cancelled'` بسبب مُصرَّح، لا حذفاً. الصفّ وسطوره وتاريخه
--    وإسناده تبقى كلها.
--
-- 3. `confirmed_at` — لحظة التأكيد التجاري، صريحة في الطلب نفسه. لا
--    تُستخرَج من `order_status_history` وقت الحاجة: ذلك الجدول
--    `ON DELETE CASCADE`، ومتى حُذف طلب (استثناءً) ضاع معه الوقت الذي
--    يعتمد عليه حدث الشراء.
--
-- 4. `capi_identity` — لقطة هوية جلسة **الزبون** وقت إرسال الطلب.
--    هذه ليست تحسيناً: حدث الشراء يُرسَل لاحقاً من فعل المدير، فلو قُرئت
--    هوية الطلب الحالي (IP/User-Agent/_fbp) لأرسلنا هوية المدير إلى Meta
--    بوصفها هوية الزبون — كل التحويلات تبدو من شخص واحد، وهو أسوأ من ألّا
--    نرسل شيئاً. ما يبقى صالحاً بعد ساعات هو ما حُفظ وقتها.
--
-- 5. `meta_purchase_sent_at` — حارس exactly-once. بدونه كل رجوع إلى
--    `confirmed` يُرسل شراءً جديداً.
--
-- 6. `order_deletions.reason` — الحذف الإداري الاستثنائي يُلزَم بسبب مكتوب.
--
-- لا شيء هنا يحذف بياناتٍ قائمة ولا يغيّر عموداً موجوداً؛ كله إضافة
-- وتوسيع قيد. الطلبات الحالية تبقى صالحة كما هي.

begin;

-- 1) `contacted` داخل قيد الحالة. القيد يُستبدَل لا يُعدَّل (Postgres لا
--    يملك ALTER CHECK)، والترتيب هنا هو ترتيب دورة الحياة لا الأبجدية.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status = any (array[
    'new'::text,
    'needs_review'::text,
    'contacted'::text,
    'confirmed'::text,
    'preparing'::text,
    'shipped'::text,
    'delivered'::text,
    'cancelled'::text,
    'returned'::text
  ])
);

-- 2) سبب الإلغاء وملاحظته.
--
-- القائمة مغلقة عمداً: سبب حرّ لا يُجمَع ولا يُقارَن، والهدف من العمود هو
-- أن يُجيب "لماذا نخسر الطلبات" بأرقام. `unreachable` و`price_rejected`
-- مفصولان عن `not_confirmed` لأنهما قصّتان مختلفتان تماماً — "لا أحد يجيب"
-- مشكلة جودة جمهور (شأن الإعلان)، و"رأى الثمن النهائي ورفض" مشكلة عرض
-- (شأن المتجر). خلطهما يُخفي أيّهما يجب إصلاحه.
alter table public.orders
  add column cancellation_reason text,
  add column cancellation_note text;

alter table public.orders add constraint orders_cancellation_reason_values check (
  cancellation_reason is null or cancellation_reason = any (array[
    'not_confirmed'::text,      -- لم يؤكّد في واتساب
    'unreachable'::text,        -- لا يجيب بعد عدة محاولات
    'customer_cancelled'::text, -- أكّد ثم تراجع
    'price_rejected'::text,     -- رأى الثمن النهائي (مع التوصيل) ورفض
    'invalid_order'::text,      -- بيانات/هاتف غير صالح، أو خارج التغطية
    'duplicate'::text,          -- مكرَّر لطلب آخر
    'out_of_stock'::text,       -- لم نقدر على توفيره
    'other'::text               -- يتطلّب cancellation_note
  ])
);

-- السبب لا معنى له على طلب حيّ: لا يُكتب إلا مع حالة تُنهي الطلب.
alter table public.orders add constraint orders_cancellation_reason_requires_status check (
  cancellation_reason is null or status = any (array['cancelled'::text, 'returned'::text])
);

-- `other` بلا شرح لا يُجيب شيئاً — وهو السبب الوحيد الذي يُلزَم بملاحظة.
alter table public.orders add constraint orders_cancellation_other_needs_note check (
  cancellation_reason is distinct from 'other'
  or (cancellation_note is not null and char_length(btrim(cancellation_note)) >= 3)
);

alter table public.orders add constraint orders_cancellation_note_length check (
  cancellation_note is null or char_length(cancellation_note) <= 500
);

-- 3) لحظة التأكيد التجاري.
alter table public.orders add column confirmed_at timestamptz;

-- 4) لقطة هوية الزبون لـConversions API.
--
-- jsonb لا أعمدة مفردة: الحقول التي تقبلها Meta تتغيّر (external_id أُضيف
-- بعد fbp/fbc)، ولقطة واحدة تُقرأ وتُرسَل كما هي أبسط من ستة أعمدة يجب
-- تعديل المخطَّط كلما زاد حقل. الشكل:
--   {"fbp": "...", "fbc": "fb.1.<ms>.<fbclid>", "clientIpAddress": "...",
--    "clientUserAgent": "...", "eventSourceUrl": "https://..."}
-- كل الحقول اختيارية: طلب مباشر بلا إعلان لن يملك fbc، وهذا صحيح لا ناقص.
alter table public.orders add column capi_identity jsonb;

-- 5) حارس exactly-once لحدث الشراء.
alter table public.orders add column meta_purchase_sent_at timestamptz;

-- 6) سبب الحذف الإداري الاستثنائي.
--
-- default '' لا NOT NULL وحده: الجدول يحمل 38 سجلاً سابقاً لا سبب لها،
-- ورفضها الآن يعني تعديل تاريخ لم يُسأل عنه وقتها.
alter table public.order_deletions add column reason text not null default '';

-- 7) تعبئة `confirmed_at` للطلبات القائمة من سجل الحالات.
--
-- أول انتقال إلى confirmed هو المقصود، لا آخره: طلب رجع إلى confirmed بعد
-- تصحيح حالة لم يُبَع مرتين. والطلبات التي شُحنت دون أن تمرّ بـconfirmed
-- (13 طلباً = 13.7% من المشحونة في الإنتاج، المدير يقفز الخطوة أحياناً)
-- تأخذ أول انتقال إلى preparing/shipped/delivered — فأيّ منها اعترافٌ بأن
-- البيعة تمّت، ومن يقفز الخطوة لا يجوز أن يختفي شراؤه بسببها.
update public.orders o
set confirmed_at = sub.at
from (
  select order_id, min(changed_at) as at
  from public.order_status_history
  where status in ('confirmed', 'preparing', 'shipped', 'delivered')
  group by order_id
) sub
where sub.order_id = o.id and o.confirmed_at is null;

-- 8) كل طلب قائم الآن يُعلَّم "لا تُرسل عنه شراءً".
--
-- هذه أخطر خطوة في الملف، ولولاها كان الإصلاح يُنتج عطلاً أكبر من الذي
-- يُصلحه.
--
-- السبب: الشراء صار يُرسَل عند أي انتقال إلى حالة بيعة. وفي الإنتاج 88
-- طلباً وصل `confirmed` من قبل، 27 منها فقط له صفّ `purchase` في
-- analytics_events. فأول لمسة حالة على أيٍّ من الـ61 الباقية — تصحيح حالة،
-- تسجيل تسليم متأخّر، أي شيء — كانت ستُرسل إلى Meta "بيعة جديدة" عن طلب
-- عمره أسابيع. وبعضها بـ`confirmed_at` مُعبَّأ من سجل قديم، فيصل بوقتٍ
-- ترفضه Meta (أقدم من سبعة أيام) أو تقبله فتنسبه إلى حملة لا علاقة لها به.
--
-- والقرار: لا تبليغ بأثر رجعي إطلاقاً. ما وقع قبل هذا التغيير قد بُلِّغ عنه
-- أو لم يُبلَّغ، وتصحيحه الآن يفسد القياس بدل أن يُكمله. الشراء المؤجَّل
-- يبدأ من الطلبات التي تُنشأ بعد اليوم وحدها.
--
-- والعمود هنا حارسٌ لا دعوى: قيمته على طلب قديم تعني "مُسكَت" لا "أُرسل".
-- ولمن له صفّ `purchase` حقيقي نضع لحظته الفعلية، فيبقى التاريخ مقروءاً.
update public.orders o
set meta_purchase_sent_at = e.occurred_at
from public.analytics_events e
where e.order_id = o.id
  and e.event_name = 'purchase'
  and o.meta_purchase_sent_at is null;

update public.orders
set meta_purchase_sent_at = now()
where meta_purchase_sent_at is null;

-- 9) حدثان داخليان جديدان في analytics_events.
--
-- `order_submitted` يحلّ محلّ `purchase` في لحظة الإرسال. ليس إعادة تسمية
-- تجميلية: الصفّ القديم كان يقول "بيعة" عن طلبٍ لم يُؤكَّد بعد، وهو نفس
-- الالتباس الذي يُصلحه هذا الملف كلّه. والقيمة التاريخية تبقى كما هي —
-- صفوف `purchase` السابقة لا تُلمَس، ويُفرَّق بين العهدين بـ`confirmed_at`
-- و`meta_purchase_sent_at`.
--
-- `confirm_on_whatsapp` يُقاس عند ضغط "أكّد طلبي على واتساب" من صفحة نجاح
-- الطلب — بعد وجود طلب حقيقي، فهو مرتبط بـ`order_id` لا سلّةٍ مجهولة.
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
    -- يبقى مسموحاً: 68 صفّاً تاريخياً تحمله، ولا سبب لرفض قراءتها.
    'purchase'::text
  ])
);

-- الضمانة الأخيرة في القاعدة نفسها، على مثال
-- `analytics_events_one_purchase_per_order_idx`: صفّ إرسال واحد لكل طلب،
-- فلا يُحتسب طلبٌ مرتين لو أُعيد نداء الكاتب لأي سبب.
create unique index analytics_events_one_submit_per_order_idx
  on public.analytics_events (order_id)
  where event_name = 'order_submitted' and order_id is not null;

comment on column public.orders.confirmed_at is
  'لحظة التأكيد التجاري (أول انتقال إلى confirmed أو ما بعدها). event_time لحدث Purchase.';
comment on column public.orders.capi_identity is
  'لقطة هوية جلسة الزبون وقت الإرسال، لـCAPI لاحقاً. لا تُقرأ هوية المدير أبداً.';
comment on column public.orders.meta_purchase_sent_at is
  'حارس exactly-once: متى أُرسل Purchase إلى Meta. غير فارغ = لا يُرسَل ثانيةً.';
comment on column public.orders.cancellation_reason is
  'سبب مُصرَّح من قائمة مغلقة. الإلغاء اليومي حالة لا حذف.';

commit;
