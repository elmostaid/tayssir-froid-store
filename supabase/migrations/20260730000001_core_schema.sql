-- Tayssir Froid — المخطط الأساسي لقاعدة البيانات
-- يُطبَّق هذا الملف على مشروع Supabase عبر: supabase db push
-- أو بلصقه داخل SQL Editor في لوحة تحكم Supabase.

-- ---------------------------------------------------------------------------
-- دالة عامة لتحديث updated_at تلقائياً عند كل تعديل
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- التصنيفات (categories) — تدعم تصنيفات فرعية عبر parent_id
-- ---------------------------------------------------------------------------
create table public.categories (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name_ar text not null,
  name_fr text,
  description_ar text,
  parent_id bigint references public.categories(id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_parent_id_idx on public.categories(parent_id);
create index categories_is_active_idx on public.categories(is_active);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- المنتجات (products)
-- ملاحظة أمنية مهمة: عمود purchase_price سري (ثمن الشراء) ويجب ألا يظهر
-- للزبناء أبداً. لا يُمنح أي وصول عام لهذا الجدول مباشرة؛ الوصول العام يتم
-- فقط عبر view منفصل (انظر ملف الهجرة الخاص بالأمان) لا يحتوي هذا العمود.
-- ---------------------------------------------------------------------------
create table public.products (
  id bigint generated always as identity primary key,
  sku text not null unique,
  slug text not null unique,
  category_id bigint not null references public.categories(id) on delete restrict,
  name_ar text not null,
  name_fr text,
  description_ar text,
  technical_specs text,
  unit_label text not null default 'قطعة',
  min_order_qty integer not null default 1 check (min_order_qty > 0),
  qty_increment integer not null default 1 check (qty_increment > 0),
  purchase_price numeric(10,2), -- سري: ثمن الشراء، لا يُعرض للزبناء أبداً
  sale_price numeric(10,2) not null check (sale_price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  meta_title text,
  meta_description text,
  -- فهرسة بحث نصي بسيطة تلائم العربية (Postgres لا يملك قاموس اشتقاق عربي
  -- مدمجاً، لذا نستعمل التهيئة 'simple' التي تطابق الكلمات كما هي)
  search_vector tsvector generated always as (
    to_tsvector('simple',
      coalesce(name_ar, '') || ' ' ||
      coalesce(name_fr, '') || ' ' ||
      coalesce(sku, '') || ' ' ||
      coalesce(description_ar, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_id_idx on public.products(category_id);
create index products_status_idx on public.products(status);
create index products_slug_idx on public.products(slug);
create index products_search_vector_idx on public.products using gin(search_vector);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- متغيرات المنتج (product_variants) — مقاسات/أنواع/ألوان مختلفة لنفس المنتج
-- الأثمنة والكميات هنا اختيارية: إن لم تُحدَّد يُستعمل ثمن/كمية المنتج الأصلي
-- ---------------------------------------------------------------------------
create table public.product_variants (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  variant_name text not null,
  sku_suffix text,
  sale_price_override numeric(10,2) check (sale_price_override >= 0),
  purchase_price_override numeric(10,2), -- سري أيضاً
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  min_order_qty_override integer check (min_order_qty_override > 0),
  qty_increment_override integer check (qty_increment_override > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, variant_name)
);

create index product_variants_product_id_idx on public.product_variants(product_id);

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- صور المنتجات (product_images) — storage_path يشير إلى مسار داخل
-- Supabase Storage (أو مسار محلي في public/ أثناء التطوير قبل ربط التخزين)
-- ---------------------------------------------------------------------------
create table public.product_images (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt_text_ar text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index product_images_product_id_idx on public.product_images(product_id);
create unique index product_images_one_primary_per_product
  on public.product_images(product_id) where is_primary;

-- ---------------------------------------------------------------------------
-- الطلبات (orders) — الطلب المُرسل من الموقع "أولي"، والمجموع النهائي
-- final_total يبقى فارغاً حتى يحدد المدير عدد الكرطونات carton_count
-- ---------------------------------------------------------------------------
create sequence public.order_number_seq;

create table public.orders (
  id bigint generated always as identity primary key,
  order_number text not null unique,
  status text not null default 'new' check (status in (
    'new', 'contacted', 'confirmed', 'preparing', 'shipped', 'delivered', 'returned', 'cancelled'
  )),
  customer_name text not null,
  customer_phone text not null,
  customer_city text not null,
  customer_address text not null,
  customer_notes text,
  items_subtotal numeric(10,2) not null check (items_subtotal >= 0),
  carton_count integer check (carton_count >= 0),
  delivery_fee numeric(10,2) check (delivery_fee >= 0),
  final_total numeric(10,2) check (final_total >= 0),
  idempotency_key text unique, -- لمنع إرسال نفس الطلب مرتين عن طريق الخطأ
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_idx on public.orders(status);
create index orders_created_at_idx on public.orders(created_at desc);
create index orders_customer_phone_idx on public.orders(customer_phone);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create or replace function public.generate_order_number()
returns trigger as $$
begin
  if new.order_number is null then
    new.order_number := 'TF-' || lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger orders_generate_order_number
  before insert on public.orders
  for each row execute function public.generate_order_number();

-- ---------------------------------------------------------------------------
-- تفاصيل الطلب (order_items) — نسخة مجمَّدة (snapshot) من اسم المنتج وثمنه
-- وقت الطلب، حتى لو تغيّر المنتج أو حُذف لاحقاً
-- ---------------------------------------------------------------------------
create table public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint references public.products(id) on delete set null,
  variant_id bigint references public.product_variants(id) on delete set null,
  product_name_snapshot text not null,
  sku_snapshot text not null,
  unit_price_snapshot numeric(10,2) not null check (unit_price_snapshot >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(10,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items(order_id);
create index order_items_product_id_idx on public.order_items(product_id);

-- ---------------------------------------------------------------------------
-- سجل تغييرات حالة الطلب (order_status_history) — تتبع تاريخي للفاتورة
-- ---------------------------------------------------------------------------
create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  status text not null,
  note text,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index order_status_history_order_id_idx on public.order_status_history(order_id);

-- ---------------------------------------------------------------------------
-- الإعدادات العامة (settings) — قيم قابلة للتعديل من لوحة الإدارة بدون كود
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

insert into public.settings (key, value) values
  ('min_order_amount_mad', to_jsonb(1000)),
  ('delivery_fee_per_carton_mad', to_jsonb(45)),
  ('whatsapp_number', to_jsonb('+212722083458'::text)),
  ('store_city', to_jsonb('مراكش - حي المحاميد'::text));

-- ---------------------------------------------------------------------------
-- ملفات تعريف المدراء (admin_profiles) — مرتبطة بمستخدمي Supabase Auth
-- ---------------------------------------------------------------------------
create table public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- التصنيفات المرجعية الحقيقية للنشاط (وليست بيانات تجريبية)
-- ---------------------------------------------------------------------------
insert into public.categories (slug, name_ar, name_fr, sort_order) values
  ('washing-machine-parts', 'قطع غيار غسالات', 'Pièces machines à laver', 1),
  ('refrigerator-parts', 'قطع غيار ثلاجات', 'Pièces réfrigérateurs', 2),
  ('freezer-parts', 'قطع غيار مجمدات', 'Pièces congélateurs', 3),
  ('ac-parts', 'قطع غيار مكيفات', 'Pièces climatiseurs', 4),
  ('cooling-tools', 'أدوات ومعدات تبريد عامة', 'Outillage froid', 5);
