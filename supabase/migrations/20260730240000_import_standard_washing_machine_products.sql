-- استيراد 18 منتجاً حقيقياً (بيانات فقط، بدون صور — لم تُرفق ملفات الصور
-- الفعلية، فقط جدول Excel) من حزمة العميل، كلها داخل تصنيف "قطع غيار آلات
-- غسيل الملابس العادية" الموجود مسبقاً. كل المنتجات تُدخل كمسودة (draft)
-- ولا تظهر للزوار إطلاقاً حتى تُنشر يدوياً من لوحة الإدارة بعد تأكيد المخزون.
-- stock_quantity = 0 هنا قيمة تقنية افتراضية فقط (العمود NOT NULL) وليست
-- ادعاءً بنفاد المخزون — المنتج مخفي عن الجمهور بحالة draft بغض النظر عنها،
-- ويجب على الإدارة إدخال المخزون الحقيقي قبل النشر.
-- ثمن الشراء (purchase_price) عمود إداري سري فقط، لا تعرضه أي view عامة.

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-001', 'standard-timer-knob',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'بوطون منتري ستاندار', 'Bouton de minuterie standard', 'بوطون ستاندار للتحكم في المنتري، متوافق مع عدة موديلات من آلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 2, 5,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-002', 'washing-machine-pulley-10-11-square',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'بولي غسالة 10 / 11 / كاري', 'Poulie de machine à laver — 10, 11 et carrée', 'بولي متوفر بثلاثة موديلات: 10 و11 وكاري، مخصص لآلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 25.5, 32,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-003', 'wash-timer-6-wires',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'منتري صابون 6 خيوط', 'Minuterie de lavage à 6 fils', 'منتري صابون ستاندار بـ6 خيوط للتحكم في مدة الغسل، متوافق مع عدة آلات غسيل عادية.',
  'قطعة', 10, 1, 9, 13,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-004', 'dryer-pressostat-seal',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'جلدة نشاف بريسيستوب', 'Joint d’essorage Pressostat', 'جلدة موطور نشاف بريسيستوب بمواصفات ستاندار، متوافقة مع أغلب آلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 7, 10,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-005', 'wash-motor-150w',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'موطور صابون 150 واط', 'Moteur de lavage 150 W', 'موطور صابون بقوة 150 واط بمواصفات ستاندار، مخصص لآلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 81.5, 88,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-006', 'washing-machine-belt',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'كروة الغسالة', 'Courroie de machine à laver', 'كروة متينة لآلات غسيل الملابس العادية، متوفرة بمقاسات متعددة.',
  'قطعة', 10, 1, 5, 7,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-007', 'wash-timer-3-wires',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'منتري صابون 3 خيوط', 'Minuterie de lavage à 3 fils', 'منتري صابون ستاندار بـ3 خيوط للتحكم في مدة الغسل، متوافق مع عدة آلات غسيل عادية.',
  'قطعة', 10, 1, 9, 13,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-008', 'washing-machine-water-hose',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'تيو الماء', 'Tuyau d’eau pour machine à laver', 'تيو ماء ستاندار ومرن، متوافق مع عدة أنواع من آلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 5, 9,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-009', 'dryer-motor-70w',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'موطور نشاف 70 واط', 'Moteur d’essorage 70 W', 'موطور نشاف بقوة 70 واط بمواصفات ستاندار، مخصص لآلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 53.5, 68,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-010', 'dryer-motor-pulley',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'بولي موطور نشاف', 'Poulie de moteur d’essorage', 'بولي موطور نشاف بمواصفات ستاندار، متوافق مع عدة آلات غسيل ملابس عادية.',
  'قطعة', 10, 1, 9, 13,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-011', 'friction-screw',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'فيس فراكة', 'Vis de friction', 'فيس فراكة مخصص لتركيب أجزاء آلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 1.5, 2.5,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-012', 'water-seal',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'جلدة الماء', 'Joint d’étanchéité d’eau', 'جلدة ماء مانعة للتسرب، متوفرة بمقاسات تناسب عدة آلات غسيل ملابس عادية.',
  'قطعة', 10, 1, 2, 5,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-013', 'water-selector-timer',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'منتري الماء سلكتور', 'Sélecteur d’eau', 'منتري ماء سلكتور بمواصفات ستاندار، متوافق مع عدة آلات غسيل ملابس عادية.',
  'قطعة', 10, 1, 11, 14,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-014', 'water-seal-spring',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'روسول جلدة الماء', 'Ressort de joint d’eau', 'روسول خاص بجلدة الماء، بمقاس ستاندار ومتوافق مع عدة آلات غسيل ملابس عادية.',
  'قطعة', 10, 1, 0.9, 2.5,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-015', 'dryer-timer-2-wires',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'منتري نشاف بخيطين', 'Minuterie d’essorage à 2 fils', 'منتري خاص بموطور النشاف بخيطين، بمواصفات ستاندار لآلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 7, 9,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-016', 'wash-motor-pulley',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'بولي موطور الصابون', 'Poulie de moteur de lavage', 'بولي خاص بموطور الصابون بمواصفات ستاندار، متوافق مع عدة آلات غسيل ملابس عادية.',
  'قطعة', 10, 1, 13, 16,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-017', 'capacitor-12-5uf',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'كوندنساتور 12/5 µF', 'Condensateur 12/5 µF', 'كوندنساتور بمقاس 12/5 µF، مخصص لآلات غسيل الملابس العادية.',
  'قطعة', 10, 1, 10, 13,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-WM-018', 'lg-double-timer',
  (select id from public.categories where slug = 'standard-washing-machine-parts'),
  'منتري LG دوبل', 'Minuterie double LG', 'منتري LG دوبل مخصص لآلات غسيل الملابس العادية المتوافقة.',
  'قطعة', 10, 1, 17, 22,
  0, 'draft'
)
on conflict (sku) do nothing;

-- TF-WM-002: منتج واحد بثلاثة متغيرات (10 / 11 / كاري) — وليس ثلاثة منتجات
insert into public.product_variants (product_id, variant_name, stock_quantity, sort_order)
select id, '10', 0, 1 from public.products where sku = 'TF-WM-002'
union all
select id, '11', 0, 2 from public.products where sku = 'TF-WM-002'
union all
select id, 'كاري', 0, 3 from public.products where sku = 'TF-WM-002';
