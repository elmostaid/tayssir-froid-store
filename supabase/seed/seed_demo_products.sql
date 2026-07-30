-- بيانات تجريبية فقط (Demo) — لاختبار الأنبوب الكامل: قاعدة البيانات ← الواجهة.
-- كل SKU يبدأ بـ DEMO- والاسم يحمل بادئة "منتج تجريبي" حتى لا يُخلط أبداً
-- بمنتجات حقيقية. يجب حذف هذه الصفوف قبل إدخال أي منتجات حقيقية للعموم.
--
-- ملاحظة: DEMO-001 وDEMO-002 حُذفا (مع تصنيفاتهما القديمة) في هجرة
-- 20260730220000_remove_demo_categories.sql؛ بقي هنا DEMO-003 فقط ضمن
-- تصنيف "أدوات ومعدات تبريد عامة" (cooling-tools) الذي لم يُحذف.
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

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select id, 'demo-images/demo-003-1.svg', 'منتج تجريبي - كبسولة غاز تبريد', 1, true
from public.products where sku = 'DEMO-003';
