-- المرحلة 2B-1: دعم حالة "غير متوفر" (out_of_stock) للمنتجات + حدود طول
-- لحقول الطلب (معالجة تحذير مؤجَّل من المرحلة 2A). لا تعديل على ملفات
-- الهجرة السابقة المطبَّقة فعلاً؛ هذا ملف إضافي فقط.

-- ---------------------------------------------------------------------------
-- إضافة حالة "out_of_stock": يختارها المدير يدوياً لمنتج يبقى ظاهراً في
-- الموقع (بخلاف draft) لكن غير قابل للطلب (بخلاف published العادي).
-- ---------------------------------------------------------------------------
alter table public.products drop constraint products_status_check;
alter table public.products add constraint products_status_check
  check (status in ('draft', 'published', 'archived', 'out_of_stock'));

-- ---------------------------------------------------------------------------
-- تحديث catalog_products: يظهر published وout_of_stock معاً (الزائر يرى
-- المنتج لكن لا يمكنه طلبه إن كان out_of_stock)، مع إضافة عمود status
-- ليُميِّز الفرق في الواجهة.
-- ---------------------------------------------------------------------------
create or replace view public.catalog_products as
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
  ) as primary_image_path,
  p.status
from public.products p
join public.categories c on c.id = p.category_id
where p.status in ('published', 'out_of_stock') and c.is_active = true;

create or replace view public.catalog_product_variants as
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
where v.is_active = true and p.status in ('published', 'out_of_stock');

-- ---------------------------------------------------------------------------
-- حدود طول معقولة لحقول الطلب (دفاع إضافي في القاعدة، بجانب التحقق في
-- الخادم والواجهة). لا تمنع أي استعمال طبيعي، فقط تمنع إدخالاً ضخماً غير
-- منطقي.
-- ---------------------------------------------------------------------------
alter table public.orders
  add constraint orders_customer_name_length check (char_length(customer_name) <= 100),
  add constraint orders_customer_city_length check (char_length(customer_city) <= 100),
  add constraint orders_customer_address_length check (char_length(customer_address) <= 300),
  add constraint orders_customer_notes_length check (customer_notes is null or char_length(customer_notes) <= 500);
