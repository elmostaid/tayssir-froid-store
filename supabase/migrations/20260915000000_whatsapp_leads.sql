-- سلة "أكمل الطلب عبر واتساب" (زر CartWhatsAppButton) — تُسجَّل هنا فور
-- الضغط، قبل فتح واتساب، بنفس المرجع W-XXXXXXXX الذي يراه الزبون في
-- الرسالة نفسها.
--
-- هذا **ليس** جدول orders: لا اسم ولا هاتف ولا مدينة معروفة بعد (الزبون
-- يُعطيها داخل محادثة واتساب لاحقاً)، ولا حجز مخزون، ولا حدث Purchase.
-- عمداً جدول منفصل بدل توسيع orders — أعمدة orders الأساسية (customer_name/
-- phone/city) إجبارية (NOT NULL) وقيد status مغلق، وكلاهما لا يصحّ هنا؛
-- توسيعها كان يعني تغيير جدول إنتاج حيّ وقواعده الحالية لحالة لا تملك بعد
-- ما تتطلّبه هذه القواعد. جدول جديد = صفر تغيير على orders/order_items.
--
-- idempotency_key (لا reference) هو مفتاح منع التكرار الحقيقي: يُولَّد في
-- المتصفح ويبقى ثابتاً طالما محتوى السلة نفسه (حتى عبر إغلاق الصفحة
-- والرجوع إليها — محفوظ في localStorage، انظر lib/orders/whatsappLeadKey.ts)،
-- فضغطتان أو رجوع-وإعادة-ضغط بنفس السلة يُنتجان نفس المفتاح ولا صفّاً
-- ثانياً. reference (W-XXXXXXXX) يُشتقّ منه بشكل حتمي وهو للعرض والبحث
-- فقط، فلا يحمل قيد unique خاصاً به: احتمال تطابق 8 خانات مُشتقّة (كما في
-- orderMessage.ts:orderReferenceFromKey) نادر لكنه وارد، ونفس الاحتمال
-- موجود أصلاً في رسائل واتساب الحالية دون أن يُعتبر عطلاً.
create table public.whatsapp_leads (
  id bigint generated always as identity primary key,
  reference text not null,
  idempotency_key text not null unique,
  status text not null default 'whatsapp_pending' check (status in (
    'whatsapp_pending', 'converted', 'abandoned'
  )),
  -- لقطة السلة كما وصلت: [{productId, variantId, name, sku, unitPrice,
  -- quantity, lineTotal}, ...] — الأسعار والأسماء من القاعدة وقت الضغط
  -- (نفس resolveOrderLines المستعمل في كل مسارات الطلب الأخرى)، لا مما
  -- أرسله المتصفح مباشرة.
  items jsonb not null,
  items_subtotal numeric(10,2) not null check (items_subtotal >= 0),
  attribution_first jsonb,
  attribution_last jsonb,
  analytics_session_id text,
  -- يُملأ عند التحويل إلى طلب حقيقي (لوحة الإدارة، createManualOrder) —
  -- انظر actions.ts. on delete set null: حذف الطلب لاحقاً لا يجوز أن يمحو
  -- سجل الـlead نفسه.
  converted_order_id bigint references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index whatsapp_leads_status_idx on public.whatsapp_leads(status);
create index whatsapp_leads_created_at_idx on public.whatsapp_leads(created_at desc);
create index whatsapp_leads_reference_idx on public.whatsapp_leads(reference);

create trigger whatsapp_leads_set_updated_at
  before update on public.whatsapp_leads
  for each row execute function public.set_updated_at();

-- نفس نمط الأمان المطبَّق على orders بالضبط (انظر 20260730000002_security.sql):
-- RLS مفعَّل بلا أي policy عامة، والكتابة الحقيقية تمرّ فقط عبر اتصال
-- الخادم المباشر (DATABASE_URL) لا PostgREST. policy المدير هنا دفاع إضافي
-- فقط تحسّباً لاستعمال supabase-js مستقبلاً من لوحة الإدارة.
alter table public.whatsapp_leads enable row level security;

create policy admin_full_access_whatsapp_leads on public.whatsapp_leads
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));
