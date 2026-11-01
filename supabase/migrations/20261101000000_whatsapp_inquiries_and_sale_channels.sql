-- كل بيعة مؤكَّدة قابلة للقياس، بقناتها الحقيقية ومصدرها المُثبَت.
--
-- ## ما كان ينقص
--
-- 1. زرّ «استفسار» وأيقونة واتساب في بطاقات المنتجات يفتحان محادثة بلا أي
--    مرجع، فالطلبية التي تُغلق فيها لا يمكن ربطها بالزيارة التي جاءت منها.
-- 2. تحويل lead واتساب إلى طلب كان يُسقط إسناده وهويته كاملين.
-- 3. لا أثر لموافقة الزبون على مشاركة بياناته — ومداولة CNDP D-939-2025
--    (28/11/2025) تشترطها مسبقاً لكوكيز الإشهار المخصَّص.
--
-- ## ما لا تفعله هذه الـmigration
--
-- لا تُغيّر `orders.source` ولا قيمته في أي صفّ: القناة الحقيقية لإتمام
-- البيع تبقى كما سُجِّلت. ولا تمنح أي طلب قائم موافقةً: الافتراضي
-- 'unknown'، فلا يُرسَل عن الطلبات القديمة شيء جديد بأثر رجعي.

-- ─── سلامة التطبيق على قاعدة حيّة ─────────────────────────────────────────
--
-- `alter table orders` يأخذ قفلاً حصرياً لحظياً (إضافة عمود بقيمة افتراضية
-- ثابتة لا تُعيد كتابة الجدول في Postgres ≥ 11، والقيد يُتحقَّق بمسح سريع
-- لبضع مئات من الصفوف). الخطر الوحيد هو **انتظار** القفل خلف معاملة طويلة،
-- وكل استعلام على orders يصطفّ خلفه. فلا ننتظر أكثر من 5 ثوانٍ: الفشل هنا
-- آمن (لا شيء يُطبَّق) ويُعاد لاحقاً، أما التعليق فيُوقف الموقع.
set lock_timeout = '5s';

-- ─── استفسارات واتساب (Q-XXXXXXXXXX) ──────────────────────────────────────
--
-- نفس فلسفة whatsapp_leads: المتصفح يولّد idempotency_key، والمرجع يُشتقّ
-- منه حتمياً على الطرفين، ويُسجَّل الصفّ بـkeepalive قبل فتح واتساب. لكن
-- المرجع هنا **فريد** بقيد: هو ما يكتبه المدير ليربط الطلبية، وتطابقٌ بين
-- استفسارين يعني ربط بيعة بزيارة لم تأتِ منها. عشر خانات لا ثمانٍ (كما في
-- W-): احتمال تطابق مرجعين بين عشرة آلاف استفسار ≈ 0.005% بدل ≈ 1.2%.
create table public.whatsapp_inquiries (
  id bigint generated always as identity primary key,
  reference text not null unique check (reference ~ '^Q-[0-9A-F]{10}$'),
  idempotency_key text not null unique,
  kind text not null check (kind in ('general', 'product')),
  product_sku text check (product_sku is null or length(product_sku) <= 64),
  page_path text check (page_path is null or length(page_path) <= 200),
  attribution_first jsonb,
  attribution_last jsonb,
  -- هوية المتصفح (fbp/fbc/IP/UA) — تُكتب فقط حين ad_consent = 'granted'.
  capi_identity jsonb,
  ad_consent text not null default 'unknown'
    check (ad_consent in ('granted', 'denied', 'unknown')),
  analytics_session_id text,
  converted_order_id bigint references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint whatsapp_inquiries_identity_needs_consent
    check (capi_identity is null or ad_consent = 'granted')
);

create index whatsapp_inquiries_created_at_idx on public.whatsapp_inquiries(created_at desc);
create unique index whatsapp_inquiries_converted_order_idx
  on public.whatsapp_inquiries(converted_order_id) where converted_order_id is not null;

alter table public.whatsapp_inquiries enable row level security;

create policy admin_full_access_whatsapp_inquiries on public.whatsapp_inquiries
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

-- ─── leads السلة: الهوية والموافقة وقت الضغط ──────────────────────────────
alter table public.whatsapp_leads
  add column capi_identity jsonb,
  add column ad_consent text not null default 'unknown'
    check (ad_consent in ('granted', 'denied', 'unknown'));

alter table public.whatsapp_leads
  add constraint whatsapp_leads_identity_needs_consent
    check (capi_identity is null or ad_consent = 'granted');

-- ─── الطلبات: المصدر المُثبَت والموافقة، بجانب القناة لا مكانها ───────────
alter table public.orders
  -- Q-… أو W-… الذي رُبطت به الطلبية. NULL = لا زيارة معروفة.
  add column origin_reference text
    check (origin_reference is null
           or origin_reference ~ '^(Q-[0-9A-F]{10}|W-[0-9A-F]{8})$'),
  add column ad_consent text not null default 'unknown'
    check (ad_consent in ('granted', 'denied', 'unknown')),
  -- من أين جاءت الموافقة: شريط الموقع، أو موروثة من استفسار/lead، أو
  -- صرّح بها المدير بعد أن سأل الزبون.
  add column ad_consent_source text
    check (ad_consent_source is null or ad_consent_source in (
      'website_banner', 'inherited', 'admin_declared'
    )),
  -- القناة التي أُرسلت بها البيعة فعلاً (website/chat/phone_call/...)،
  -- للتدقيق: ما وصل Meta لا يُستنتَج، يُقرأ.
  add column meta_purchase_action_source text;

create index orders_origin_reference_idx on public.orders(origin_reference)
  where origin_reference is not null;

-- ─── الاحتفاظ: 180 يوماً (حدّ CNDP لبيانات الكوكيز) ────────────────────────
--
-- تمحو ما مصدره متصفح الزائر (fbp/fbc/IP/UA ومعرّفات النقر)، وتُبقي ما
-- يحتاجه الدفتر التجاري (الطلب، سطوره، القناة، UTM المجمَّع). تُرجع عدد
-- الصفوف الممحوّة في كل جدول، ولا تلمس ما هو أحدث من الحدّ.
create or replace function public.purge_expired_tracking_identity(p_days integer default 180)
returns table(orders_purged bigint, leads_purged bigint, inquiries_purged bigint)
language plpgsql
as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  click_keys text[] := array['fbclid', 'gclid', 'ttclid'];
  o bigint; l bigint; q bigint;
begin
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

  return query select o, l, q;
end;
$$;

revoke all on function public.purge_expired_tracking_identity(integer) from public, anon, authenticated;

reset lock_timeout;
