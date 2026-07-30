-- بيانات تجريبية فقط (Demo) — لاختبار الأنبوب الكامل: قاعدة البيانات ← الواجهة.
-- كل SKU يبدأ بـ DEMO- والاسم يحمل بادئة "منتج تجريبي" حتى لا يُخلط أبداً
-- بمنتجات حقيقية. يجب حذف هذه الصفوف قبل إدخال أي منتجات حقيقية للعموم.
--
-- الصور: بما أن مخزن الصور الحقيقي (Supabase Storage) لم يُنشأ بعد، تشير
-- storage_path هنا إلى صور SVG placeholder داخل public/demo-images في مشروع
-- Next.js، فقط لأغراض المعاينة المحلية.

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar, technical_specs,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, meta_title, meta_description
) values
(
  'DEMO-001',
  'demo-hizam-drama-ghassala',
  (select id from public.categories where slug = 'washing-machine-parts'),
  'منتج تجريبي - حزام دراما غسالة',
  'Courroie tambour (démo)',
  'منتج تجريبي فقط لاختبار عرض المنتجات، متوفر بمقاسين مختلفين.',
  'مطاط مقوى، متوافق مع أغلب الماركات — بيانات تجريبية',
  'قطعة', 5, 5, 8.00, 18.00, 120, 'published',
  'منتج تجريبي - حزام دراما غسالة | Tayssir Froid',
  'منتج تجريبي لاختبار الموقع، سيُستبدل ببيانات حقيقية بعد المراجعة.'
),
(
  'DEMO-002',
  'demo-filter-thallaja',
  (select id from public.categories where slug = 'refrigerator-parts'),
  'منتج تجريبي - فلتر ثلاجة',
  'Filtre réfrigérateur (démo)',
  'منتج تجريبي فقط لاختبار عرض المنتجات دون متغيرات.',
  'فلتر مياه قياسي — بيانات تجريبية',
  'قطعة', 10, 10, 15.00, 25.00, 50, 'published',
  'منتج تجريبي - فلتر ثلاجة | Tayssir Froid',
  'منتج تجريبي لاختبار الموقع، سيُستبدل ببيانات حقيقية بعد المراجعة.'
),
(
  'DEMO-003',
  'demo-capsule-gaz-tabrid',
  (select id from public.categories where slug = 'cooling-tools'),
  'منتج تجريبي - كبسولة غاز تبريد',
  'Bouteille gaz réfrigérant (démo)',
  'منتج تجريبي فقط لاختبار عرض المنتجات بكمية دنيا صغيرة.',
  'R134a — بيانات تجريبية',
  'قطعة', 1, 1, 90.00, 120.00, 30, 'published',
  'منتج تجريبي - كبسولة غاز تبريد | Tayssir Froid',
  'منتج تجريبي لاختبار الموقع، سيُستبدل ببيانات حقيقية بعد المراجعة.'
);

insert into public.product_variants (product_id, variant_name, stock_quantity, sort_order)
select id, 'مقاس A', 60, 1 from public.products where sku = 'DEMO-001'
union all
select id, 'مقاس B', 60, 2 from public.products where sku = 'DEMO-001';

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select id, 'demo-images/demo-001-1.svg', 'منتج تجريبي - حزام دراما غسالة', 1, true
from public.products where sku = 'DEMO-001'
union all
select id, 'demo-images/demo-002-1.svg', 'منتج تجريبي - فلتر ثلاجة', 1, true
from public.products where sku = 'DEMO-002'
union all
select id, 'demo-images/demo-003-1.svg', 'منتج تجريبي - كبسولة غاز تبريد', 1, true
from public.products where sku = 'DEMO-003';
