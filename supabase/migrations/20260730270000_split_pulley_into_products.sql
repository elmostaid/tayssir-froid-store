-- بناءً على طلب صريح لاحق: بولي 10 / بولي 11 / بولي كاري تصبح ثلاثة
-- منتجات مستقلة، كل واحد بكارته وصفحته الخاصة — وليس متغيرات لمنتج واحد.
-- هذا لا يمس المنتج القديم TF-WM-002 (بولي غسالة 10/11/كاري بمتغيراته
-- الثلاثة) في هذه الهجرة؛ قرار حذفه أو إبقاءه بانتظار تأكيد صريح من
-- العميل لتفادي حذف بيانات دون إذن.
-- نفس التصنيف (قطع غيار آلات غسيل الملابس العادية)، نفس الثمن ونفس
-- شروط البيع المستعملة في باقي منتجات هذا التصنيف. لا صور بعد — بانتظار
-- رفع الملفين الفعليين.

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-019', 'washing-machine-pulley-10',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'بولي 10', 'Poulie 10',
  'بولي متوفر بثلاثة موديلات: 10 و11 وكاري، مخصص لآلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 25.5, 32,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-020', 'washing-machine-pulley-11',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'بولي 11', 'Poulie 11',
  'بولي متوفر بثلاثة موديلات: 10 و11 وكاري، مخصص لآلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 25.5, 32,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-021', 'washing-machine-pulley-square',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'بولي كاري', 'Poulie carrée',
  'بولي متوفر بثلاثة موديلات: 10 و11 وكاري، مخصص لآلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 25.5, 32,
  0, 'draft'
)
on conflict (sku) do nothing;
