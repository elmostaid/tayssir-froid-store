-- ربط الصور الفعلية بالمنتجات الـ18 (حزمة ثانية من العميل تحتوي الصور
-- الحقيقية) حسب SKU وimage_1/image_2 من products.json. لا تعديل على
-- المنتجات نفسها ولا إنشاء أي تصنيف أو منتج جديد — إضافة صفوف
-- product_images فقط. جميع المنتجات تبقى مسودة (draft) كما كانت.
--
-- تُستعمل SKU (وليس المعرّف الرقمي id) كاسم مجلد الصور المحلي
-- (product-images/{sku}/...) عمداً هنا، لأن id تسلسلي يختلف حتماً بين
-- بيئة وأخرى (محلي/CI/إنتاج) بينما SKU ثابت في كل مكان؛ صور رفع لوحة
-- الإدارة العادية (المستقبلية) تبقى بنفس اتفاقية product-images/{id}/...
-- الموجودة أصلاً في src/lib/storage/productImages.ts دون أي تغيير.

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-001/TF-WM-001-standard-timer-knob.jpg', 'صورة بوطون منتري ستاندار', 1, true
from public.products p
where p.sku = 'TF-WM-001'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-001/TF-WM-001-standard-timer-knob.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-002/TF-WM-002-washing-machine-pulley.jpg', 'صورة بولي غسالة 10 / 11 / كاري', 1, true
from public.products p
where p.sku = 'TF-WM-002'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-002/TF-WM-002-washing-machine-pulley.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-003/TF-WM-003-wash-timer-6-wires.jpg', 'صورة منتري صابون 6 خيوط', 1, true
from public.products p
where p.sku = 'TF-WM-003'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-003/TF-WM-003-wash-timer-6-wires.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-004/TF-WM-004-dryer-pressostat-seal-1.jpg', 'صورة جلدة نشاف بريسيستوب', 1, true
from public.products p
where p.sku = 'TF-WM-004'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-004/TF-WM-004-dryer-pressostat-seal-1.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-004/TF-WM-004-dryer-pressostat-seal-2.jpg', 'صورة جلدة نشاف بريسيستوب', 2, false
from public.products p
where p.sku = 'TF-WM-004'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-004/TF-WM-004-dryer-pressostat-seal-2.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-005/TF-WM-005-wash-motor-150w.jpg', 'صورة موطور صابون 150 واط', 1, true
from public.products p
where p.sku = 'TF-WM-005'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-005/TF-WM-005-wash-motor-150w.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-006/TF-WM-006-washing-machine-belt.jpg', 'صورة كروة الغسالة', 1, true
from public.products p
where p.sku = 'TF-WM-006'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-006/TF-WM-006-washing-machine-belt.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-007/TF-WM-007-wash-timer-3-wires.jpg', 'صورة منتري صابون 3 خيوط', 1, true
from public.products p
where p.sku = 'TF-WM-007'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-007/TF-WM-007-wash-timer-3-wires.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-008/TF-WM-008-water-hose.jpg', 'صورة تيو الماء', 1, true
from public.products p
where p.sku = 'TF-WM-008'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-008/TF-WM-008-water-hose.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-009/TF-WM-009-dryer-motor-70w.jpg', 'صورة موطور نشاف 70 واط', 1, true
from public.products p
where p.sku = 'TF-WM-009'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-009/TF-WM-009-dryer-motor-70w.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-010/TF-WM-010-dryer-motor-pulley.jpg', 'صورة بولي موطور نشاف', 1, true
from public.products p
where p.sku = 'TF-WM-010'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-010/TF-WM-010-dryer-motor-pulley.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-011/TF-WM-011-friction-screw.jpg', 'صورة فيس فراكة', 1, true
from public.products p
where p.sku = 'TF-WM-011'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-011/TF-WM-011-friction-screw.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-012/TF-WM-012-water-seal.jpg', 'صورة جلدة الماء', 1, true
from public.products p
where p.sku = 'TF-WM-012'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-012/TF-WM-012-water-seal.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-013/TF-WM-013-water-selector-timer.jpg', 'صورة منتري الماء سلكتور', 1, true
from public.products p
where p.sku = 'TF-WM-013'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-013/TF-WM-013-water-selector-timer.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-014/TF-WM-014-water-seal-spring.jpg', 'صورة روسول جلدة الماء', 1, true
from public.products p
where p.sku = 'TF-WM-014'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-014/TF-WM-014-water-seal-spring.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-015/TF-WM-015-dryer-timer-2-wires.jpg', 'صورة منتري نشاف بخيطين', 1, true
from public.products p
where p.sku = 'TF-WM-015'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-015/TF-WM-015-dryer-timer-2-wires.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-016/TF-WM-016-wash-motor-pulley.jpg', 'صورة بولي موطور الصابون', 1, true
from public.products p
where p.sku = 'TF-WM-016'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-016/TF-WM-016-wash-motor-pulley.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-017/TF-WM-017-capacitor-12-5uf.jpg', 'صورة كوندنساتور 12/5 µF', 1, true
from public.products p
where p.sku = 'TF-WM-017'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-017/TF-WM-017-capacitor-12-5uf.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-WM-018/TF-WM-018-lg-double-timer.jpg', 'صورة منتري LG دوبل', 1, true
from public.products p
where p.sku = 'TF-WM-018'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-WM-018/TF-WM-018-lg-double-timer.jpg'
  );
