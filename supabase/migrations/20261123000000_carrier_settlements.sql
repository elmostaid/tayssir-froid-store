-- تسويات شركات التوصيل: فواتير BigDelivery (ثم OzonExpress) تُرفَع من اللوحة،
-- فتُطابَق كرطوناتها مع الطلبيات، ويُسجَّل التسليم وتكلفة التوصيل الحقيقية.
--
-- ## ما يفعله هذا الملف — وما لا يفعله
--
-- **جداول جديدة فقط.** لا عمود يُضاف إلى `orders` ولا يُعدَّل ولا يُحذف، ولا
-- صفّ قائم يُلمَس. كل ما يكتبه النظام لاحقاً في الطلبيات يقع في عمودين
-- موجودين أصلاً: `status` و`actual_delivery_cost`، وكل كتابة منهما تُسجَّل
-- في `carrier_settlement_changes` بقيمتها القديمة والجديدة لتُعكَس عند التراجع.
--
-- ## لماذا خمسة جداول
--
--   carrier_invoices           الفاتورة: رقمها، بصمة ملفها، مجاميعها، وحالتها.
--   carrier_invoice_files      الملف الأصلي نفسه (bytea) — منفصل ليبقى الجدول
--                              الأول خفيفاً في القراءة، وخاصاً بلا رابط عمومي.
--   carrier_parcels            كل كرطونة في الفاتورة سطراً: الهاتف والمبلغ
--                              والرسوم والحالة. «حقائق الشركة» كما وردت.
--   carrier_order_settlements  قرار «هذه الطلبية سُوِّيت بهذه الكرطونات».
--   carrier_settlement_changes سجلّ كل تغيير على طلبية، ليُعكَس بأمان.
--
-- ## الحمايات التي تحملها القاعدة نفسها (لا الكود وحده)
--
-- 1. نفس الملف لا يُسجَّل مرتين: `file_sha256` فريد.
-- 2. نفس الفاتورة لا تُسجَّل مرتين ولو بملف مختلف: (carrier, invoice_number) فريد.
-- 3. نفس الكرطونة لا تُحتسَب مرتين ولو وردت في فاتورتين: فهرس فريد جزئي على
--    (carrier, tracking_code) للكرطونات الفعّالة.
-- 4. الطلبية لا تُسوّى مرتين: فهرس فريد جزئي على order_id للتسويات غير المتراجَع عنها.
--
-- RLS مُفعَّل بلا سياسات، كنمط operating_expenses و analytics_events: كل
-- قراءة وكتابة تمرّ عبر اتصال الخادم المباشر من صفحات /admin المقصورة على
-- صاحب الحساب. لا anon ولا authenticated يبلغ هذه الجداول عبر PostgREST.

begin;

create table public.carrier_invoices (
  id bigint generated always as identity primary key,
  carrier text not null check (carrier in ('bigdelivery', 'ozonexpress')),
  invoice_number text not null check (char_length(invoice_number) between 1 and 120),
  invoice_date date,
  -- حالة الفاتورة كما كتبتها الشركة (مثلاً «Payé») — للعرض، لا يُبنى عليها قرار.
  carrier_status text check (carrier_status is null or char_length(carrier_status) <= 60),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text check (file_name is null or char_length(file_name) <= 255),
  parcel_count integer not null check (parcel_count >= 0),
  total_cod numeric(12,2) not null check (total_cod >= 0),
  total_fees numeric(12,2) not null check (total_fees >= 0),
  other_fees numeric(12,2) not null default 0 check (other_fees >= 0),
  total_net numeric(12,2) not null,
  -- active: كرطوناتها محتسَبة. rolled_back: تراجعنا عنها، وكل ما بُني عليها عُكِس.
  status text not null default 'active' check (status in ('active', 'rolled_back')),
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  rolled_back_by text,
  rolled_back_at timestamptz,
  -- الحالة الثالثة المنفصلة: الفلوس وصلت للبنك فعلاً (يُدخلها المالك بيده).
  bank_received_at timestamptz,
  bank_received_amount numeric(12,2) check (bank_received_amount is null or bank_received_amount >= 0),
  bank_marked_by text,
  constraint carrier_invoices_file_sha256_key unique (file_sha256),
  constraint carrier_invoices_number_key unique (carrier, invoice_number),
  constraint carrier_invoices_bank_pair check ((bank_received_at is null) = (bank_received_amount is null))
);

create table public.carrier_invoice_files (
  invoice_id bigint primary key references public.carrier_invoices(id) on delete cascade,
  content bytea not null,
  content_type text not null default 'application/pdf',
  -- سقف 10 ميغا: فاتورة BigDelivery من 10 كرطونات = 120 كيلو.
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760)
);

create table public.carrier_order_settlements (
  id bigint generated always as identity primary key,
  -- set null لا cascade ولا restrict: الحذف الإداري الاستثنائي للطلب يبقى
  -- ممكناً كما هو، والسجلّ المالي يبقى قائماً بعده.
  order_id bigint references public.orders(id) on delete set null,
  -- الفاتورة التي اكتملت بها الطلبية (آخر كرطونة وصلت).
  invoice_id bigint not null references public.carrier_invoices(id),
  parcel_ids bigint[] not null,
  parcel_count integer not null check (parcel_count > 0),
  cod_total numeric(12,2) not null,
  fee_total numeric(12,2) not null check (fee_total >= 0),
  -- high: عدد الكرطونات مسجَّل ومطابق. medium: غير مسجَّل أو المدينة غير قابلة للمقارنة.
  confidence text not null check (confidence in ('high', 'medium')),
  -- auto: من «جاهزة» بالموافقة الجماعية. approved: حالة كانت تحتاج قرار المالك ووافق عليها.
  decision text not null check (decision in ('auto', 'approved')),
  settled_by text,
  settled_at timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by text,
  revert_reason text
);

create unique index carrier_order_settlements_one_active_per_order
  on public.carrier_order_settlements (order_id)
  where reverted_at is null and order_id is not null;

create table public.carrier_parcels (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.carrier_invoices(id),
  carrier text not null check (carrier in ('bigdelivery', 'ozonexpress')),
  line_no integer not null check (line_no > 0),
  tracking_code text not null check (char_length(tracking_code) between 3 and 60),
  phone text,
  -- آخر 9 أرقام: نفس المفتاح مهما كُتب الهاتف (06… أو +2126… أو 2126…).
  phone_key text check (phone_key is null or phone_key ~ '^[0-9]{9}$'),
  city text,
  cod_amount numeric(10,2) not null check (cod_amount >= 0),
  fee numeric(10,2) not null check (fee >= 0),
  carrier_status text not null check (carrier_status in ('delivered', 'returned', 'refused', 'other')),
  carrier_status_raw text,
  pickup_date date,
  delivery_date date,
  -- محتسَبة أم لا. كرطونة مكرَّرة من فاتورة سابقة تُحفَظ للأثر ولا تُفعَّل.
  active boolean not null default false,
  skip_reason text check (skip_reason is null or skip_reason in ('duplicate', 'duplicate_conflict')),
  settlement_id bigint references public.carrier_order_settlements(id),
  constraint carrier_parcels_line_key unique (invoice_id, line_no),
  constraint carrier_parcels_skip_inactive check (skip_reason is null or not active),
  constraint carrier_parcels_settled_active check (settlement_id is null or active)
);

-- الحماية 3: كرطونة واحدة فعّالة لكل رقم تتبّع عند كل شركة.
create unique index carrier_parcels_one_active_tracking
  on public.carrier_parcels (carrier, tracking_code)
  where active;

-- المطابقة تبحث دائماً في الكرطونات الفعّالة غير المسوّاة بالهاتف.
create index carrier_parcels_open_by_phone
  on public.carrier_parcels (phone_key)
  where active and settlement_id is null;

create index carrier_parcels_invoice_idx on public.carrier_parcels (invoice_id);
create index carrier_parcels_settlement_idx on public.carrier_parcels (settlement_id)
  where settlement_id is not null;

create table public.carrier_settlement_changes (
  id bigint generated always as identity primary key,
  settlement_id bigint not null references public.carrier_order_settlements(id),
  order_id bigint references public.orders(id) on delete set null,
  field text not null check (field in ('status', 'actual_delivery_cost')),
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by text,
  -- التراجع لا يكتب فوق تعديل لاحق: إن تغيّرت القيمة بعدنا يُسجَّل السبب هنا وتبقى كما هي.
  revert_skipped_reason text
);

create index carrier_settlement_changes_settlement_idx
  on public.carrier_settlement_changes (settlement_id);
create index carrier_settlement_changes_order_idx
  on public.carrier_settlement_changes (order_id);

alter table public.carrier_invoices enable row level security;
alter table public.carrier_invoice_files enable row level security;
alter table public.carrier_parcels enable row level security;
alter table public.carrier_order_settlements enable row level security;
alter table public.carrier_settlement_changes enable row level security;

comment on table public.carrier_invoices is
  'فواتير شركات التوصيل النهائية المرفوعة من اللوحة. لا تُقبل فاتورة لا تطابق مجاميعها سطورها.';
comment on table public.carrier_parcels is
  'كرطونات الفواتير كما وردت. active=true: محتسَبة. لا كرطونتان فعّالتان بنفس رقم التتبع.';
comment on table public.carrier_order_settlements is
  'تسوية طلبية: الكرطونات التي اكتملت بها ومجموع رسومها. تسوية واحدة فعّالة لكل طلبية.';
comment on table public.carrier_settlement_changes is
  'كل تغيير كتبه نظام التسويات في orders بقيمته القديمة والجديدة، لتراجعٍ لا يمسّ التعديلات اللاحقة.';

commit;
