-- قياس داخلي مجهول لمسار الزائر (Funnel) — جدول جديد بالكامل، لا يُعدَّل ولا
-- يُقرأ منه أي جدول قائم.
--
-- لماذا جدول خاص بدل الاعتماد على Meta وحدها: Meta تعدّ الأحداث لا الأشخاص،
-- ولا ترى إلا ما يُطلقه Pixel فعلاً. هذا الجدول يجيب عن السؤال الذي لا يمكن
-- أن تجيب عنه: كم شخصاً (جلسة) وصل كل مرحلة، لا كم حدثاً وقع.
--
-- الخصوصية شرط تصميم لا إضافة: لا اسم ولا هاتف ولا عنوان ولا ملاحظات ولا أي
-- شيء يكتبه الزبون في نموذج الطلب. حتى referrer يُخزَّن كاسم نطاق فقط لا
-- كرابط كامل قد يحمل بارامترات شخصية، وfbclid لا تُخزَّن قيمته إطلاقاً — فقط
-- إشارة إلى وجوده (has_click_id) تكفي للتفريق بين زيارة مدفوعة وعضوية.

create table public.analytics_events (
  id            bigserial primary key,

  -- مُعرّف جلسة مجهول يُولَّد في المتصفح (crypto.randomUUID). لا علاقة له بأي
  -- حساب أو هوية، ويُنسى تلقائياً بعد 30 دقيقة خمول.
  session_id    uuid        not null,

  -- قائمة مغلقة صراحةً: أي اسم حدث خارجها يُرفَض من القاعدة نفسها، لا من
  -- الكود وحده.
  event_name    text        not null check (event_name in (
                  'session_start',
                  'landing_page_view',
                  'product_view',
                  'add_to_cart',
                  'cart_view',
                  'begin_checkout',
                  'purchase'
                )),

  -- وقت الخادم دائماً، لا وقت جهاز الزائر (ساعات الهواتف غير موثوقة، وفرق
  -- ساعة واحدة يكفي لنسب حدثاً إلى اليوم الخطأ في تقرير يومي).
  occurred_at   timestamptz not null default now(),

  page_path     text,
  landing_path  text,
  referrer_host text,

  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  has_click_id  boolean     not null default false,

  device_type   text        check (device_type in ('mobile', 'tablet', 'desktop')),
  browser       text,
  viewport_w    integer,
  viewport_h    integer,

  -- سياق المنتج/السلة — يُملأ فقط في الأحداث التي تعنيه.
  product_id    bigint      references public.products(id) on delete set null,
  sku           text,
  quantity      integer,
  cart_value    numeric(12, 2),

  -- ربط الشراء بالطلب الحقيقي. on delete set null بنفس منطق stock_movements
  -- بالضبط: حذف طلب من لوحة الإدارة يجب ألا يُسقط سجلّاً تحليلياً، وسجلّ
  -- تحليلي يجب ألا يمنع حذف طلب.
  order_id      bigint      references public.orders(id) on delete set null,
  order_value   numeric(12, 2),

  -- المدة منذ بداية الجلسة بالميلي ثانية، كما قاسها المتصفح.
  session_ms    integer
);

-- التقارير كلها "آخر N يوماً مقسَّمة حسب اليوم"، فالفهرس الزمني هو الأهم.
create index analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at desc);

-- عدّ الجلسات الفريدة لكل مرحلة — الاستعلام الأساسي في اللوحة.
create index analytics_events_event_time_idx
  on public.analytics_events (event_name, occurred_at desc);

-- تتبّع مسار جلسة واحدة كاملة.
create index analytics_events_session_idx
  on public.analytics_events (session_id);

-- RLS مُفعَّل بلا أي سياسة: الكتابة تقع حصراً عبر اتصال الخادم المباشر
-- (DATABASE_URL) من /api/analytics، والقراءة عبر نفس الاتصال من لوحة
-- الإدارة. لا anon key ولا authenticated يصل هذا الجدول عبر PostgREST
-- إطلاقاً — فلا يستطيع أحد لا حشو الجدول ببيانات مزيفة ولا قراءة سلوك
-- الزوّار منه.
alter table public.analytics_events enable row level security;
