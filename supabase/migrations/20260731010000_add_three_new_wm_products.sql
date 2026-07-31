-- إضافة 3 منتجات مستقلة جديدة (رجل نشاف / روسول باب / بولي LG) — كانت
-- صورهم من حزمة الاستبدال بدون تطابق واثق مع أي منتج قائم، وأكّد العميل
-- أنها منتجات جديدة فعلاً. SKU يتابع من آخر رقم مستعمل في هذا التصنيف
-- (TF-WM-021) فيبدأ من TF-WM-022. لا وصف ولا ثمن شراء مُعطى من العميل
-- لهذه الدفعة، فتُركا فارغين (NULL) بدل اختراعهما. لا تخترع مخزون —
-- stock_quantity = 0 قيمة تقنية فقط (العمود NOT NULL)، والحالة draft
-- تُبقي المنتج مخفياً عن الزوار بغض النظر عنها.

insert into public.products (
  sku, slug, category_id, name_ar, unit_label,
  min_order_qty, qty_increment, sale_price, stock_quantity, status
) values (
  'TF-WM-022', 'dryer-foot-mount',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'رجل نشاف', 'قطعة', 10, 1, 8, 0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, unit_label,
  min_order_qty, qty_increment, sale_price, stock_quantity, status
) values (
  'TF-WM-023', 'door-spring',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'روسول باب', 'قطعة', 10, 1, 4, 0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, unit_label,
  min_order_qty, qty_increment, sale_price, stock_quantity, status
) values (
  'TF-WM-024', 'lg-pulley',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'بولي LG', 'قطعة', 10, 1, 60, 0, 'draft'
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-022/dryer-foot.png', 'صورة رجل نشاف', 1, true
from public.products p
where p.sku = 'TF-WM-022'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-022/dryer-foot.png'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-023/door-spring.png', 'صورة روسول باب', 1, true
from public.products p
where p.sku = 'TF-WM-023'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-023/door-spring.png'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-024/lg-pulley.png', 'صورة بولي LG', 1, true
from public.products p
where p.sku = 'TF-WM-024'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-024/lg-pulley.png'
  );
