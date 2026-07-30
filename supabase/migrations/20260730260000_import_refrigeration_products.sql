-- استيراد 22 منتجاً حقيقياً (ثلاجات ومكيفات سبليت منزلية) من حزمة العميل
-- الثالثة، بياناتها ومتغيراتها وصورها، داخل التصنيفين الموجودين مسبقاً
-- (قطع غيار الثلاجات / قطع غيار المكيفات المنزلية سبليت) حسب ما هو محدد
-- لكل منتج. كل المنتجات والمتغيرات تُدخل كمسودة (draft) ولا تُنشر. لا
-- تُخترع أي كمية مخزون (0 قيمة تقنية فقط، العمود NOT NULL). ثمن الشراء
-- عمود إداري سري فقط، لا تعرضه أي view عامة.

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-001', 'copper-brazing-flux-blue-flux-4',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'بودر نحاس أزرق FLUX-4', 'Flux de brasage cuivre bleu FLUX-4', 'بودر ديكابون خاص بلحام النحاس بجودة عالية.',
  'قطعة', 1, 1, 18, 20,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-002', 'brass-flare-nut-raccord',
  (select id from public.categories where slug = 'split-ac-parts'),
  'راكور إكرو نحاس', 'Raccord écrou en laiton', 'راكور إكرو نحاس متوفر بخمسة مقاسات لأنظمة التبريد والتكييف.',
  'قطعة', 1, 1, 6, 8,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-003', 'hollow-brass-mamelon',
  (select id from public.categories where slug = 'split-ac-parts'),
  'ماملو خاوي نحاس', 'Mamelon creux en laiton', 'ماملو خاوي نحاس متوفر بخمسة مقاسات لأنظمة التبريد والتكييف.',
  'قطعة', 1, 1, 10, 15,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-004', 'aluminium-flux-powder-f407',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'بودر ألمنيوم F407', 'Décapant aluminium F407', 'بودر سماوي خاص بلحام الألمنيوم بجودة عالية.',
  'قطعة', 1, 1, 35, 45,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-005', 'single-gas-manometer-ct-467',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'مانو غاز برو CT-467', 'Manomètre gaz Pro CT-467', 'مانو غاز أحادي CT-467 مناسب لأعمال التبريد ومختلف غازات التبريد.',
  'قطعة', 1, 1, 65, 85,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-006', 'vacuum-pump',
  (select id from public.categories where slug = 'split-ac-parts'),
  'بومبا فيد', 'Pompe à vide', 'بومبا فيد لتفريغ الهواء من دوائر التبريد والتكييف.',
  'قطعة', 1, 1, 650, 900,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-007', 'refrigerator-fan-12v-three-wires',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'فرفارة ثلاجة 12V بثلاثة خيوط', 'Ventilateur de réfrigérateur 12 V à 3 fils', 'فرفارة ثلاجة 12V بثلاثة خيوط للتبريد الداخلي.',
  'قطعة', 1, 1, 100, 130,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-008', 'professional-flaring-kit-large',
  (select id from public.categories where slug = 'split-ac-parts'),
  'ديدجنير كبير احترافي', 'Coffret d’évasement professionnel grand modèle', 'طقم احترافي كبير لتوسيع وتطويع أنابيب النحاس.',
  'قطعة', 1, 1, 210, 320,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-009', 'compact-flaring-tool',
  (select id from public.categories where slug = 'split-ac-parts'),
  'ديدجنير صغير', 'Outil d’évasement compact', 'ديدجنير صغير لمقاسات أنابيب النحاس بجودة عالية.',
  'قطعة', 1, 1, 100, 130,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-010', 'refrigerant-gas-r32-3kg',
  (select id from public.categories where slug = 'split-ac-parts'),
  'غاز التبريد R32 حجم 3kg', 'Gaz réfrigérant R32 — 3 kg', 'غاز تبريد R32 حجم 3kg لأنظمة التكييف المتوافقة.',
  'قطعة', 1, 1, 550, 800,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-011', 'professional-eccentric-flaring-tool',
  (select id from public.categories where slug = 'split-ac-parts'),
  'ديدجنير حمرة احترافي', 'Outil d’évasement excentrique professionnel', 'أداة احترافية لتطويع أنابيب النحاس بدقة في أنظمة التبريد والتكييف.',
  'قطعة', 1, 1, 280, 320,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-012', 'lg-air-conditioner-fan',
  (select id from public.categories where slug = 'split-ac-parts'),
  'فرفارة مكيف LG', 'Ventilateur de climatiseur LG', 'فرفارة متوافقة مع موديلات مكيف LG المناسبة.',
  'قطعة', 1, 1, 130, 170,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-013', 'universal-air-conditioner-remote',
  (select id from public.categories where slug = 'split-ac-parts'),
  'تلكموند مكيف يونيفرسال', 'Télécommande universelle de climatiseur', 'تلكموند يونيفرسال متوافقة مع عدد كبير من ماركات المكيفات.',
  'قطعة', 1, 1, 25, 45,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-014', 'quick-valve',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'فالف رابيد', 'Valve rapide', 'فالف رابيد سريع وسهل الاستعمال في أعمال التبريد.',
  'قطعة', 1, 1, 15, 18,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-015', 'italian-copper-filter-drier',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'فلتر نحاس إيطالي', 'Filtre déshydrateur cuivre italien', 'فلتر نحاس إيطالي متوفر بأوزان 15g و20g و30g.',
  'قطعة', 1, 1, 7, 9,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-016', 'large-tube-cutter',
  (select id from public.categories where slug = 'split-ac-parts'),
  'كوب تيب كبير', 'Coupe-tube grand modèle', 'كوب تيب احترافي كبير لقطع أنابيب النحاس.',
  'قطعة', 1, 1, 38, 45,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-017', 'double-refrigeration-manifold-yellow',
  (select id from public.categories where slug = 'split-ac-parts'),
  'مانو غاز دوبل أصفر', 'Manifold frigoriste double jaune', 'مانو غاز دوبل احترافي بالعدادين للعمل على دوائر التبريد والتكييف.',
  'قطعة', 1, 1, 240, 290,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-018', 'refrigerator-timer-models',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'منتري ثلاجة', 'Minuterie de réfrigérateur', 'منتري ثلاجة متوفرة بستة موديلات أصلية حسب الجهاز.',
  'قطعة', 1, 1, 28, 37,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-019', 'black-refrigerator-fan-220v',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'فرفارة ثلاجة سوداء 220V', 'Ventilateur noir de réfrigérateur 220 V', 'فرفارة ثلاجة سوداء 220V بجودة عالية.',
  'قطعة', 1, 1, 40, 50,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-020', 'refrigerant-gas-r22-1kg',
  (select id from public.categories where slug = 'split-ac-parts'),
  'غاز التبريد R22 حجم 1kg', 'Gaz réfrigérant R22 — 1 kg', 'غاز تبريد R22 صافي بحجم 1kg للأنظمة المتوافقة.',
  'قطعة', 1, 1, 300, 350,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-021', 'r600-charging-head',
  (select id from public.categories where slug = 'refrigerator-spare-parts'),
  'راس شارج R600', 'Raccord de charge R600', 'راس شارج R600 مخصص لخدمة دوائر تبريد الثلاجات المتوافقة.',
  'قطعة', 1, 1, 17, 22,
  0, 'draft'
)
on conflict (sku) do nothing;

insert into public.products (
  sku, slug, category_id, name_ar, name_fr, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status
) values (
  'TF-RF-022', 'air-conditioning-charging-heads',
  (select id from public.categories where slug = 'split-ac-parts'),
  'رؤوس شحن المكيفات', 'Raccords de charge pour climatisation', 'رؤوس شحن متوفرة لغازات وتطبيقات السيارة وR1234 وR410.',
  'قطعة', 1, 1, 18, 25,
  0, 'draft'
)
on conflict (sku) do nothing;

-- المتغيرات (لكل منتج فيه has_variants = true فقط)
insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '1/4', 'TF-RF-002-14', 8, 6, 0, 1
from public.products p
where p.sku = 'TF-RF-002'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '1/4'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '3/8', 'TF-RF-002-38', 13, 9, 0, 2
from public.products p
where p.sku = 'TF-RF-002'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '3/8'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '1/2', 'TF-RF-002-12', 15, 12, 0, 3
from public.products p
where p.sku = 'TF-RF-002'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '1/2'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '5/8', 'TF-RF-002-58', 20, 12, 0, 4
from public.products p
where p.sku = 'TF-RF-002'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '5/8'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '3/4', 'TF-RF-002-34', 30, 20, 0, 5
from public.products p
where p.sku = 'TF-RF-002'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '3/4'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '1/4', 'TF-RF-003-14', 15, 10, 0, 1
from public.products p
where p.sku = 'TF-RF-003'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '1/4'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '3/8', 'TF-RF-003-38', 20, 15, 0, 2
from public.products p
where p.sku = 'TF-RF-003'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '3/8'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '1/2', 'TF-RF-003-12', 25, 20, 0, 3
from public.products p
where p.sku = 'TF-RF-003'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '1/2'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '5/8', 'TF-RF-003-58', 30, 25, 0, 4
from public.products p
where p.sku = 'TF-RF-003'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '5/8'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '3/4', 'TF-RF-003-34', 35, 30, 0, 5
from public.products p
where p.sku = 'TF-RF-003'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '3/4'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '15 غرام', 'TF-RF-015-15G', 9, 7, 0, 1
from public.products p
where p.sku = 'TF-RF-015'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '15 غرام'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '20 غرام', 'TF-RF-015-20G', 10, 8, 0, 2
from public.products p
where p.sku = 'TF-RF-015'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '20 غرام'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, '30 غرام', 'TF-RF-015-30G', 13, 9.5, 0, 3
from public.products p
where p.sku = 'TF-RF-015'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = '30 غرام'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'TMDF702ZD1', 'TF-RF-018-702ZD1', 37, 28, 0, 1
from public.products p
where p.sku = 'TF-RF-018'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'TMDF702ZD1'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'TMDF704ZT1', 'TF-RF-018-704ZT1', 37, 28, 0, 2
from public.products p
where p.sku = 'TF-RF-018'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'TMDF704ZT1'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'TMDE706SC1', 'TF-RF-018-706SC1', 37, 28, 0, 3
from public.products p
where p.sku = 'TF-RF-018'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'TMDE706SC1'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'TMDF702CB1', 'TF-RF-018-702CB1', 37, 28, 0, 4
from public.products p
where p.sku = 'TF-RF-018'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'TMDF702CB1'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'TMDF704SC1', 'TF-RF-018-704SC1', 37, 28, 0, 5
from public.products p
where p.sku = 'TF-RF-018'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'TMDF704SC1'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'TMDJ704ZC1', 'TF-RF-018-J704ZC1', 37, 28, 0, 6
from public.products p
where p.sku = 'TF-RF-018'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'TMDJ704ZC1'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'فالف شارج سيارة', 'TF-RF-022-CAR', 55, 40, 0, 1
from public.products p
where p.sku = 'TF-RF-022'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'فالف شارج سيارة'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'فالف شارج R1234', 'TF-RF-022-R1234', 140, 110, 0, 2
from public.products p
where p.sku = 'TF-RF-022'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'فالف شارج R1234'
  );

insert into public.product_variants (product_id, variant_name, sku_suffix, sale_price_override, purchase_price_override, stock_quantity, sort_order)
select p.id, 'فالف شارج R410', 'TF-RF-022-R410', 25, 18, 0, 3
from public.products p
where p.sku = 'TF-RF-022'
  and not exists (
    select 1 from public.product_variants pv
    where pv.product_id = p.id and pv.variant_name = 'فالف شارج R410'
  );

-- الصور (image_1 لكل منتج؛ صورتان منها مشتركتان بين منتجين عمداً)
insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-001/TF-RF-001-copper-brazing-flux.jpg', 'صورة بودر نحاس أزرق FLUX-4', 1, true
from public.products p
where p.sku = 'TF-RF-001'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-001/TF-RF-001-copper-brazing-flux.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/shared/TF-RF-002-003-raccords-mamelons.jpg', 'صورة راكور إكرو نحاس', 1, true
from public.products p
where p.sku = 'TF-RF-002'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/shared/TF-RF-002-003-raccords-mamelons.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/shared/TF-RF-002-003-raccords-mamelons.jpg', 'صورة ماملو خاوي نحاس', 1, true
from public.products p
where p.sku = 'TF-RF-003'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/shared/TF-RF-002-003-raccords-mamelons.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-004/TF-RF-004-aluminium-flux-powder.jpg', 'صورة بودر ألمنيوم F407', 1, true
from public.products p
where p.sku = 'TF-RF-004'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-004/TF-RF-004-aluminium-flux-powder.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-005/TF-RF-005-single-gas-manometer.jpg', 'صورة مانو غاز برو CT-467', 1, true
from public.products p
where p.sku = 'TF-RF-005'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-005/TF-RF-005-single-gas-manometer.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-006/TF-RF-006-vacuum-pump.jpg', 'صورة بومبا فيد', 1, true
from public.products p
where p.sku = 'TF-RF-006'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-006/TF-RF-006-vacuum-pump.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-007/TF-RF-007-fridge-fan-12v.jpg', 'صورة فرفارة ثلاجة 12V بثلاثة خيوط', 1, true
from public.products p
where p.sku = 'TF-RF-007'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-007/TF-RF-007-fridge-fan-12v.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-008/TF-RF-008-large-flaring-kit.jpg', 'صورة ديدجنير كبير احترافي', 1, true
from public.products p
where p.sku = 'TF-RF-008'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-008/TF-RF-008-large-flaring-kit.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-009/TF-RF-009-small-flaring-tool.jpg', 'صورة ديدجنير صغير', 1, true
from public.products p
where p.sku = 'TF-RF-009'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-009/TF-RF-009-small-flaring-tool.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-010/TF-RF-010-r32-gas-3kg.jpg', 'صورة غاز التبريد R32 حجم 3kg', 1, true
from public.products p
where p.sku = 'TF-RF-010'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-010/TF-RF-010-r32-gas-3kg.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-011/TF-RF-011-red-flaring-tool.jpg', 'صورة ديدجنير حمرة احترافي', 1, true
from public.products p
where p.sku = 'TF-RF-011'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-011/TF-RF-011-red-flaring-tool.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-012/TF-RF-012-lg-ac-fan.jpg', 'صورة فرفارة مكيف LG', 1, true
from public.products p
where p.sku = 'TF-RF-012'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-012/TF-RF-012-lg-ac-fan.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-013/TF-RF-013-universal-ac-remote.jpg', 'صورة تلكموند مكيف يونيفرسال', 1, true
from public.products p
where p.sku = 'TF-RF-013'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-013/TF-RF-013-universal-ac-remote.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-014/TF-RF-014-fast-valve.jpg', 'صورة فالف رابيد', 1, true
from public.products p
where p.sku = 'TF-RF-014'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-014/TF-RF-014-fast-valve.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-015/TF-RF-015-filter-drier.jpg', 'صورة فلتر نحاس إيطالي', 1, true
from public.products p
where p.sku = 'TF-RF-015'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-015/TF-RF-015-filter-drier.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-016/TF-RF-016-large-tube-cutter.jpg', 'صورة كوب تيب كبير', 1, true
from public.products p
where p.sku = 'TF-RF-016'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-016/TF-RF-016-large-tube-cutter.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-017/TF-RF-017-double-manifold.jpg', 'صورة مانو غاز دوبل أصفر', 1, true
from public.products p
where p.sku = 'TF-RF-017'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-017/TF-RF-017-double-manifold.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-018/TF-RF-018-refrigerator-timer.jpg', 'صورة منتري ثلاجة', 1, true
from public.products p
where p.sku = 'TF-RF-018'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-018/TF-RF-018-refrigerator-timer.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-019/TF-RF-019-black-fridge-fan-220v.jpg', 'صورة فرفارة ثلاجة سوداء 220V', 1, true
from public.products p
where p.sku = 'TF-RF-019'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-019/TF-RF-019-black-fridge-fan-220v.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-RF-020/TF-RF-020-r22-gas-1kg.jpg', 'صورة غاز التبريد R22 حجم 1kg', 1, true
from public.products p
where p.sku = 'TF-RF-020'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/TF-RF-020/TF-RF-020-r22-gas-1kg.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/shared/TF-RF-021-022-charging-heads.jpg', 'صورة راس شارج R600', 1, true
from public.products p
where p.sku = 'TF-RF-021'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/shared/TF-RF-021-022-charging-heads.jpg'
  );

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/shared/TF-RF-021-022-charging-heads.jpg', 'صورة رؤوس شحن المكيفات', 1, true
from public.products p
where p.sku = 'TF-RF-022'
  and not exists (
    select 1 from public.product_images pi
    where pi.product_id = p.id and pi.storage_path = 'product-images/shared/TF-RF-021-022-charging-heads.jpg'
  );
