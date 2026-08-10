-- ---------------------------------------------------------------------------
-- ترتيب المنتجات يدوياً داخل كل تصنيف (أزرار "↑ طلّع" / "↓ هبّط" فـ
-- /admin/products): عمود sort_order صحيح بسيط لكل منتج، بلا أي تعديل على
-- الاسم/الثمن/المخزون/الصور/SKU/الحالة.
--
-- القيمة الابتدائية لكل منتج حالي = ترتيبه الحالي بالضبط (الأحدث أولاً،
-- created_at desc — نفس الترتيب المعروض فعلياً اليوم قبل هذا الملف)، بحيث
-- لا يتغيّر أي ترتيب ظاهر للزبون فور تطبيق هذا الملف — فقط بعد أول استعمال
-- فعلي لأزرار "↑"/"↓" يبدأ الترتيب اليدوي فالظهور.
-- ---------------------------------------------------------------------------
alter table public.products add column sort_order integer not null default 0;

update public.products p
set sort_order = ranked.rn
from (
  select id, row_number() over (partition by category_id order by created_at desc, id desc) as rn
  from public.products
) ranked
where ranked.id = p.id;

create index products_category_sort_order_idx on public.products (category_id, sort_order);

-- catalog_products تحتاج sort_order مُتاحاً لاستعلامات العرض للزبون
-- (getProducts فـcatalog.ts) لترتيب المنتجات به أولاً — بقية الأعمدة كما
-- كانت بالضبط بلا أي تغيير. العمود الجديد يُضاف فآخر القائمة حصراً
-- (CREATE OR REPLACE VIEW يمنع تغيير موقع/اسم أي عمود موجود مسبقاً).
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
  p.status,
  p.sort_order
from public.products p
join public.categories c on c.id = p.category_id
where p.status in ('published', 'out_of_stock') and c.is_active = true;
