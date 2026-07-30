-- ربط الصور الفعلية بالمنتجات الثلاثة المستقلة (بولي 10 / بولي 11 /
-- بولي كاري) بعد رفعها كملفات مرفقة. لا تعديل على الاسم أو الثمن أو
-- التصنيف — إضافة صف صورة رئيسية واحدة لكل منتج فقط.

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-019/poli_10.jpg', 'صورة بولي 10', 1, true
from public.products p
where p.sku = 'TF-WM-019'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-019/poli_10.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-020/poli_11.jpg', 'صورة بولي 11', 1, true
from public.products p
where p.sku = 'TF-WM-020'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-020/poli_11.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-021/poli_kari.jpg', 'صورة بولي كاري', 1, true
from public.products p
where p.sku = 'TF-WM-021'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-021/poli_kari.jpg'
  );
