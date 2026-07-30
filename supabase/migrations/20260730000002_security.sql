-- الأمان: تفعيل RLS ومنع أي وصول عام مباشر للجداول الأصلية
--
-- سبب هذا الملف: مشاريع Supabase تُفعِّل تلقائياً واجهة REST عامة (PostgREST)
-- فوق كل الجداول داخل schema باسم public. بدون RLS، أي شخص يملك مفتاح anon
-- (وهو غير سري بطبيعته) يمكنه استعلام الجداول مباشرة — بما فيها عمود
-- purchase_price (ثمن الشراء السري). لذلك:
--   1) نُفعِّل RLS على كل الجداول الأصلية بدون أي policy عامة => رفض تام.
--   2) ننشئ views عامة "آمنة" تستثني الأعمدة السرية، ونمنحها SELECT فقط
--      لدوري anon و authenticated.
--   3) الكتابة (إضافة/تعديل منتجات وطلبات) تتم فقط عبر كود الخادم (Next.js)
--      باستخدام اتصال قاعدة بيانات مباشر (DATABASE_URL) لا يمر عبر PostgREST،
--      وليس عبر الـ anon key من المتصفح — لذلك لا حاجة لأي policy كتابة عامة.

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.settings enable row level security;
alter table public.admin_profiles enable row level security;

-- policy وحيدة: المدير المسجَّل دخوله (موجود في admin_profiles) له كل الصلاحيات
-- عبر Supabase Auth، مفيدة إن استُعملت لوحة إدارة تعتمد على supabase-js مستقبلاً.
create policy admin_full_access_categories on public.categories
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

create policy admin_full_access_products on public.products
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

create policy admin_full_access_product_variants on public.product_variants
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

create policy admin_full_access_product_images on public.product_images
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

create policy admin_full_access_orders on public.orders
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

create policy admin_full_access_order_items on public.order_items
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

create policy admin_full_access_order_status_history on public.order_status_history
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

create policy admin_full_access_settings on public.settings
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));

create policy self_read_admin_profile on public.admin_profiles
  for select to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Views عامة آمنة (بدون أي عمود سري) — القراءة فقط، تعرض المنشور فقط
-- ملاحظة: هذه الـ views مملوكة لنفس مالك الجداول، لذا RLS على الجداول
-- الأصلية لا يمنعها من القراءة الداخلية (نمط قياسي في Supabase لإخفاء أعمدة).
-- ---------------------------------------------------------------------------
create view public.catalog_categories as
select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order
from public.categories
where is_active = true;

create view public.catalog_products as
select
  p.id,
  p.sku,
  p.slug,
  p.category_id,
  c.slug as category_slug,
  c.name_ar as category_name_ar,
  p.name_ar,
  p.name_fr,
  p.description_ar,
  p.technical_specs,
  p.unit_label,
  p.min_order_qty,
  p.qty_increment,
  p.sale_price,
  p.stock_quantity,
  p.meta_title,
  p.meta_description,
  p.created_at,
  (
    select pi.storage_path
    from public.product_images pi
    where pi.product_id = p.id
    order by pi.is_primary desc, pi.sort_order asc
    limit 1
  ) as primary_image_path
from public.products p
join public.categories c on c.id = p.category_id
where p.status = 'published' and c.is_active = true;

create view public.catalog_product_variants as
select
  v.id,
  v.product_id,
  v.variant_name,
  coalesce(v.sale_price_override, p.sale_price) as sale_price,
  v.stock_quantity,
  coalesce(v.min_order_qty_override, p.min_order_qty) as min_order_qty,
  coalesce(v.qty_increment_override, p.qty_increment) as qty_increment,
  v.sort_order
from public.product_variants v
join public.products p on p.id = v.product_id
where v.is_active = true and p.status = 'published';

create view public.catalog_product_images as
select id, product_id, storage_path, alt_text_ar, sort_order, is_primary
from public.product_images;

grant usage on schema public to anon, authenticated;
grant select on public.catalog_categories to anon, authenticated;
grant select on public.catalog_products to anon, authenticated;
grant select on public.catalog_product_variants to anon, authenticated;
grant select on public.catalog_product_images to anon, authenticated;
