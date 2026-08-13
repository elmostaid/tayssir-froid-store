-- استيراد 28 منتجاً حقيقياً (أقفال أمان أبواب مكينات الغسيل الأوتوماتيكية،
-- موديلات 1-28) من دفعة العميل الخامسة، داخل التصنيف الموجود مسبقاً
-- automatic-washing-machine-parts (id=16). SKU يتبع النمط الحالي
-- TF-AWM-NNN (بادئة جديدة مشتقة من slug التصنيف، لا تعارض مع أي بادئة
-- موجودة). الإدخال محمي من التكرار عبر on conflict (sku)، ومطابقة
-- الصور بـ NOT EXISTS، فيمكن إعادة تشغيل هذا الملف بأمان. ثمن الشراء
-- (عمود purchase_price) إداري سري فقط، لا يظهر لأي view عامة. الكمية
-- 500 قيمة مؤقتة (كما هي الحال في بقية المنتجات المنشورة حالياً في
-- المتجر) ريثما يحدّث المدير الكميات الحقيقية.

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-001', 'automatic-washer-door-lock-model-01', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 1', 'قفل باب كامل بهيكل بلاستيكي أبيض، مدخل مستطيل للسان الباب، تثبيت بفتحتين، وفيشتان منفصلتان للتوصيل كما هو موضح في الصور. يُرجى قبل الطلب مقارنة شكل القفل والفيش وأطراف التوصيل ومواضع التثبيت مع القطعة الأصلية لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 100, 150,
  500, 'published', 1
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-001/TF-AWM-001-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 1 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-001'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-001/TF-AWM-001-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-001/TF-AWM-001-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 1 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-001'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-001/TF-AWM-001-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-001/TF-AWM-001-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 1 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-001'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-001/TF-AWM-001-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-002', 'automatic-washer-door-lock-model-02', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 2', 'قفل باب طويل بهيكل أبيض وأسود، مدخل مستطيل للسان الباب، فيشة سوداء واحدة تحتوي على 3 أطراف توصيل، وواجهة تثبيت بها 4 فتحات. يُرجى قبل الطلب مقارنة شكل القفل والفيشة وأطراف التوصيل ومواضع التثبيت مع القطعة الأصلية لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 100, 150,
  500, 'published', 2
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-002/TF-AWM-002-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 2 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-002'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-002/TF-AWM-002-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-002/TF-AWM-002-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 2 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-002'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-002/TF-AWM-002-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-002/TF-AWM-002-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 2 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-002'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-002/TF-AWM-002-3.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-002/TF-AWM-002-4.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 2 - صورة 4', 4, false
from public.products p
where p.sku = 'TF-AWM-002'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-002/TF-AWM-002-4.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-003', 'automatic-washer-door-lock-model-03', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 3', 'قفل باب طويل بهيكل رمادي وواجهة علوية سوداء، مدخل مستطيل للسان الباب، فتحتان للتثبيت، وفيشة جانبية مدمجة بثلاثة أطراف توصيل. يُرجى قبل الطلب مقارنة شكل القفل والفيشة وأطرافها ومواضع التثبيت مع القطعة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 80, 120,
  500, 'published', 3
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-003/TF-AWM-003-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 3 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-003'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-003/TF-AWM-003-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-003/TF-AWM-003-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 3 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-003'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-003/TF-AWM-003-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-003/TF-AWM-003-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 3 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-003'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-003/TF-AWM-003-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-004', 'automatic-washer-door-lock-model-04', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 4', 'قفل باب بهيكل بلاستيكي أسود، مدخل مستطيل للسان الباب، فتحتان دائريتان للتثبيت، وفيشة جانبية بثلاثة أطراف توصيل. يُرجى قبل الطلب مقارنة شكل القفل والفيشة وعدد أطرافها واتجاه مدخل اللسان ومواضع التثبيت مع القطعة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 4
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-004/TF-AWM-004-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 4 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-004'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-004/TF-AWM-004-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-004/TF-AWM-004-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 4 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-004'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-004/TF-AWM-004-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-004/TF-AWM-004-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 4 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-004'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-004/TF-AWM-004-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-005', 'automatic-washer-door-lock-model-05', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 5', 'قفل باب بتصميم طويل ورفيع وهيكل بلاستيكي بلون بني داكن، مع مدخل مستطيل للسان الباب في الجهة العلوية وفتحات دائرية مخصصة للتركيب. يُرجى قبل الطلب مقارنة الشكل العام، أبعاد القفل، اتجاه مدخل اللسان، فتحات التثبيت ونقاط التوصيل مع القطعة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 70, 100,
  500, 'published', 5
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-005/TF-AWM-005-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 5 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-005'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-005/TF-AWM-005-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-005/TF-AWM-005-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 5 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-005'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-005/TF-AWM-005-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-005/TF-AWM-005-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 5 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-005'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-005/TF-AWM-005-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-006', 'automatic-washer-door-lock-model-06', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 6', 'قفل باب بتصميم طويل ومستطيل وهيكل بلاستيكي بلون بني داكن وأسود، مع جهة توصيل مدمجة تضم 4 أطراف معدنية ظاهرة. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه التركيب، عدد أطراف التوصيل وترتيبها مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 70, 100,
  500, 'published', 6
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-006/TF-AWM-006-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 6 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-006'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-006/TF-AWM-006-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-006/TF-AWM-006-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 6 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-006'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-006/TF-AWM-006-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-006/TF-AWM-006-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 6 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-006'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-006/TF-AWM-006-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-007', 'automatic-washer-door-lock-model-07', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 7', 'قفل باب بتصميم طويل وهيكل بلاستيكي بني، مزود بدعامة معدنية داخلية ومدخل مستطيل للسان الباب في الأعلى، مع 3 أطراف توصيل مسطحة جانبية ظاهرة ومواصفة 220V مكتوبة على القطعة. يُرجى قبل الطلب مقارنة الشكل والأبعاد، مدخل اللسان، فتحات التثبيت، عدد أطراف التوصيل وترتيبها مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 60, 80,
  500, 'published', 7
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-007/TF-AWM-007-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 7 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-007'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-007/TF-AWM-007-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-007/TF-AWM-007-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 7 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-007'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-007/TF-AWM-007-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-007/TF-AWM-007-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 7 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-007'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-007/TF-AWM-007-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-008', 'automatic-washer-door-lock-model-08', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 8', 'قفل باب بهيكل بلاستيكي أسود، مدخل مستطيل عريض للسان الباب، وفيشة بيضاء جانبية مدمجة تضم 3 أطراف توصيل معدنية. تظهر على القطعة مواصفة 16(6)A 250V~. يُرجى قبل الطلب مقارنة الشكل العام، اتجاه مدخل اللسان، شكل الفيشة، عدد أطرافها وترتيبها ومواضع التثبيت مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 8
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-008/TF-AWM-008-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 8 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-008'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-008/TF-AWM-008-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-008/TF-AWM-008-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 8 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-008'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-008/TF-AWM-008-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-008/TF-AWM-008-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 8 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-008'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-008/TF-AWM-008-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-009', 'automatic-washer-door-lock-model-09', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 9', 'قفل باب بهيكل بلاستيكي أسود وأبيض، مدخل مستطيل عريض للسان الباب في الأعلى، فتحتان جانبيتان للتثبيت، وفيشة مدمجة تضم 4 أطراف توصيل معدنية ظاهرة. تظهر على القطعة مواصفة 16(6)A 250V~. يُرجى قبل الطلب مقارنة الشكل العام، اتجاه مدخل اللسان، شكل الفيشة، عدد أطرافها وترتيبها ومواضع التثبيت مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 150,
  500, 'published', 9
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-009/TF-AWM-009-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 9 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-009'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-009/TF-AWM-009-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-009/TF-AWM-009-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 9 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-009'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-009/TF-AWM-009-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-009/TF-AWM-009-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 9 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-009'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-009/TF-AWM-009-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-010', 'automatic-washer-door-lock-model-10', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 10', 'قفل باب بهيكل بلاستيكي أسود وأبيض وتصميم غير متماثل، مع مدخل مستطيل للسان الباب في الأسفل وذراع ميكانيكي جانبي، وفيشة بيضاء مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. يُرجى قبل الطلب مقارنة الشكل العام، اتجاه مدخل اللسان والذراع الجانبي، شكل الفيشة، عدد أطرافها وترتيبها ومواضع التثبيت مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 10
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-010/TF-AWM-010-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 10 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-010'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-010/TF-AWM-010-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-010/TF-AWM-010-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 10 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-010'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-010/TF-AWM-010-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-010/TF-AWM-010-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 10 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-010'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-010/TF-AWM-010-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-011', 'automatic-washer-door-lock-model-11', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 11', 'قفل باب بهيكل بلاستيكي أسود وأبيض، مدخل مستطيل عريض للسان الباب، ذراع ميكانيكي جانبي طويل، وفيشة بيضاء مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. تظهر على القطعة مواصفة 4-5 16(6)A 250V~ والمرجع DKS08. يُرجى قبل الطلب مقارنة الشكل العام، اتجاه مدخل اللسان والذراع الجانبي، شكل الفيشة، عدد أطرافها وترتيبها ومواضع التثبيت مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 11
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-011/TF-AWM-011-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 11 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-011'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-011/TF-AWM-011-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-011/TF-AWM-011-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 11 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-011'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-011/TF-AWM-011-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-011/TF-AWM-011-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 11 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-011'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-011/TF-AWM-011-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-012', 'automatic-washer-door-lock-model-12', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 12', 'قفل باب بتصميم طويل وهيكل بلاستيكي أسود وأبيض، قاعدة تثبيت مثلثة بفتحتين ملولبتين، ومدخل مستطيل عريض للسان الباب في الأسفل. مزود بفيشة بيضاء جانبية تضم 3 أطراف توصيل معدنية، وتظهر على القطعة عبارة DM SERIES. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه مدخل اللسان، المسافة بين فتحتي التثبيت، شكل الفيشة وعدد أطرافها وترتيبها مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 12
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-012/TF-AWM-012-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 12 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-012'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-012/TF-AWM-012-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-012/TF-AWM-012-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 12 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-012'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-012/TF-AWM-012-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-012/TF-AWM-012-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 12 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-012'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-012/TF-AWM-012-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-013', 'automatic-washer-door-lock-model-13', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 13', 'قفل باب بهيكل بلاستيكي أبيض وأسود، مدخل مستطيل عريض للسان الباب، ذراع ميكانيكي جانبي، وفيشة بيضاء مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. تظهر على القطعة مواصفة 1-2 16(6)A 250V~ والمرجع DKS67A. يُرجى قبل الطلب مقارنة الشكل العام، اتجاه مدخل اللسان والذراع الجانبي، شكل الفيشة، عدد أطرافها وترتيبها ومواضع التثبيت مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 13
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-013/TF-AWM-013-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 13 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-013'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-013/TF-AWM-013-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-013/TF-AWM-013-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 13 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-013'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-013/TF-AWM-013-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-013/TF-AWM-013-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 13 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-013'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-013/TF-AWM-013-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-014', 'automatic-washer-door-lock-model-14', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 14', 'قفل باب كبير بهيكل بلاستيكي أبيض وتصميم مسطح، مدخل مستطيل عميق للسان الباب في الواجهة، وذراع ميكانيكي علوي. مزود بفيشة مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه مدخل اللسان والذراع، شكل الفيشة، عدد أطرافها وترتيبها ونقاط التثبيت مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 150,
  500, 'published', 14
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-014/TF-AWM-014-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 14 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-014'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-014/TF-AWM-014-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-014/TF-AWM-014-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 14 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-014'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-014/TF-AWM-014-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-014/TF-AWM-014-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 14 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-014'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-014/TF-AWM-014-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-015', 'automatic-washer-door-lock-model-15', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 15', 'قفل باب كبير بهيكل بلاستيكي أبيض وأسود، مدخل مستطيل عميق للسان الباب في الواجهة، وذراع ميكانيكي علوي. مزود بفيشة بيضاء مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. تظهر على القطعة مواصفة 1-2 16(6)A 250V~ والمرجع DKS67A. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه مدخل اللسان والذراع، شكل الفيشة، عدد أطرافها وترتيبها ونقاط التثبيت مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 15
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-015/TF-AWM-015-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 15 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-015'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-015/TF-AWM-015-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-015/TF-AWM-015-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 15 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-015'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-015/TF-AWM-015-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-015/TF-AWM-015-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 15 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-015'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-015/TF-AWM-015-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-016', 'automatic-washer-door-lock-model-16', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 16', 'قفل باب بتصميم طويل وهيكل بلاستيكي أبيض مع جزء داخلي بني، مدخل مستطيل للسان الباب في الأعلى، وقاعدة تثبيت علوية بفتحتين دائريتين. مزود بفيشة مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه مدخل اللسان، المسافة بين فتحتي التثبيت، شكل الفيشة، عدد أطرافها وترتيبها مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 50, 80,
  500, 'published', 16
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-016/TF-AWM-016-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 16 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-016'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-016/TF-AWM-016-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-016/TF-AWM-016-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 16 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-016'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-016/TF-AWM-016-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-016/TF-AWM-016-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 16 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-016'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-016/TF-AWM-016-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-017', 'automatic-washer-door-lock-model-17', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 17', 'قفل باب بهيكل بلاستيكي أسود مدمج، مدخل مستطيل للسان الباب في الأسفل، فتحتان دائريتان للتثبيت، وذراع ميكانيكي علوي جانبي. مزود بفيشة بيضاء مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. تظهر على القطعة مواصفة T85 و16(6)A 250V~. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه مدخل اللسان والذراع، المسافة بين فتحتي التثبيت، شكل الفيشة، عدد أطرافها وترتيبها مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 150,
  500, 'published', 17
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-017/TF-AWM-017-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 17 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-017'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-017/TF-AWM-017-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-017/TF-AWM-017-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 17 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-017'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-017/TF-AWM-017-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-017/TF-AWM-017-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 17 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-017'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-017/TF-AWM-017-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-018', 'automatic-washer-door-lock-model-18', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 18', 'قفل باب بهيكل بلاستيكي أسود وأبيض، مدخل مستطيل عريض للسان الباب في الأعلى، وفتحتان دائريتان جانبيتان للتثبيت. مزود بفيشة بيضاء مدمجة تضم 4 أطراف توصيل معدنية ظاهرة. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه مدخل اللسان، المسافة بين فتحتي التثبيت، شكل الفيشة، عدد أطرافها وترتيبها مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 150,
  500, 'published', 18
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-018/TF-AWM-018-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 18 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-018'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-018/TF-AWM-018-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-018/TF-AWM-018-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 18 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-018'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-018/TF-AWM-018-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-018/TF-AWM-018-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 18 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-018'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-018/TF-AWM-018-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-019', 'automatic-washer-door-lock-model-19', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 19', 'قفل باب بتصميم طويل وهيكل بلاستيكي أبيض وأحمر، مدخل مستطيل للسان الباب في الأعلى، وقاعدة علوية تضم أربع فتحات دائرية. مزود بفيشة جانبية حمراء تضم 3 أطراف توصيل معدنية ظاهرة، وتظهر على القطعة مواصفة 220V و16(6)A. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه مدخل اللسان، فتحات التثبيت، شكل الفيشة، عدد أطرافها وترتيبها مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 45, 70,
  500, 'published', 19
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-019/TF-AWM-019-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 19 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-019'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-019/TF-AWM-019-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-019/TF-AWM-019-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 19 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-019'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-019/TF-AWM-019-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-019/TF-AWM-019-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 19 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-019'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-019/TF-AWM-019-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-020', 'automatic-washer-door-lock-model-20', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 20', 'قفل باب بتصميم طويل وهيكل بلاستيكي رمادي فاتح، مدخل مستطيل عريض للسان الباب في الأعلى، وقاعدة تثبيت طويلة بفتحتين دائريتين مع آلية جانبية. مزود بفيشة مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. يُرجى قبل الطلب مقارنة الشكل والأبعاد، اتجاه مدخل اللسان، المسافة بين فتحتي التثبيت، شكل الفيشة، عدد أطرافها وترتيبها مع القفل والفيشة الأصلية والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 150,
  500, 'published', 20
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-020/TF-AWM-020-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 20 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-020'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-020/TF-AWM-020-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-020/TF-AWM-020-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 20 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-020'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-020/TF-AWM-020-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-020/TF-AWM-020-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 20 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-020'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-020/TF-AWM-020-3.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-020/TF-AWM-020-4.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 20 - صورة 4', 4, false
from public.products p
where p.sku = 'TF-AWM-020'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-020/TF-AWM-020-4.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-021', 'automatic-washer-door-lock-model-21', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 21', 'قفل أمان باب بتصميم طويل وهيكل بلاستيكي أبيض، مدخل مستطيل عريض للسان الباب في الأعلى، وفتحتان دائريتان علويتان للتثبيت. يتضمن صفيحة معدنية داخلية مع نوابض ظاهرة، وفيشة جانبية مدمجة تضم 4 أطراف توصيل مرقمة من 2 إلى 5. يُرجى قبل الطلب مقارنة شكل القطعة وأبعادها، اتجاه مدخل اللسان، المسافة بين فتحتي التثبيت، شكل الفيشة وعدد أطرافها وترتيبها مع القفل والفيشة الأصليين والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 150,
  500, 'published', 21
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-021/TF-AWM-021-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 21 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-021'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-021/TF-AWM-021-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-021/TF-AWM-021-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 21 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-021'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-021/TF-AWM-021-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-021/TF-AWM-021-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 21 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-021'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-021/TF-AWM-021-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-022', 'automatic-washer-door-lock-model-22', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 22', 'قفل أمان باب بهيكل بلاستيكي أسود عريض، مدخل جانبي مستطيل للسان الباب، وفتحتان دائريتان للتثبيت موزعتان بشكل مائل. يتضمن صفيحة معدنية داخلية وآلية بنابض، وموصلاً كهربائياً مدمجاً داخل غطاء مستطيل عريض بثلاث خانات ظاهرة. يظهر على الهيكل المرجع 126060704. يُرجى قبل الطلب مقارنة شكل القطعة وأبعادها، اتجاه مدخل اللسان، مواضع فتحتي التثبيت، شكل الفيشة وخاناتها مع القفل والفيشة الأصليين والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 60, 100,
  500, 'published', 22
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-022/TF-AWM-022-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 22 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-022'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-022/TF-AWM-022-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-022/TF-AWM-022-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 22 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-022'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-022/TF-AWM-022-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-022/TF-AWM-022-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 22 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-022'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-022/TF-AWM-022-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-023', 'automatic-washer-door-lock-model-23', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 23', 'قفل أمان باب بتصميم طويل وهيكل بلاستيكي أبيض مع جزء علوي أسود، مدخل مستطيل للسان الباب في الأعلى، وقاعدة علوية تضم أربع فتحات دائرية لاختيار موضع التثبيت. مزود بفيشة جانبية مدمجة تضم 3 أطراف توصيل معدنية ظاهرة، ويظهر على القطعة المرجع 320033136. يُرجى قبل الطلب مقارنة شكل القطعة وأبعادها، اتجاه مدخل اللسان، فتحات التثبيت، شكل الفيشة وعدد أطرافها وترتيبها مع القفل والفيشة الأصليين والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 45, 70,
  500, 'published', 23
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-023/TF-AWM-023-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 23 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-023'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-023/TF-AWM-023-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-023/TF-AWM-023-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 23 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-023'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-023/TF-AWM-023-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-023/TF-AWM-023-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 23 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-023'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-023/TF-AWM-023-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-024', 'automatic-washer-door-lock-model-24', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 24', 'قفل أمان باب بهيكل بلاستيكي رمادي وأسود، مدخل مستطيل عميق للسان الباب في الجزء العلوي، وآلية تثبيت جانبية مع ذراع ميكانيكي. مزود بفيشة بيضاء مدمجة تضم 3 أطراف توصيل معدنية ظاهرة. تظهر على القطعة المواصفة T85 IE4 و1-2 16(6)A 250V~ والمرجع DK042. يُرجى قبل الطلب مقارنة شكل القطعة وأبعادها، اتجاه مدخل اللسان والذراع، نقاط التثبيت، شكل الفيشة وعدد أطرافها وترتيبها مع القفل والفيشة الأصليين والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 24
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-024/TF-AWM-024-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 24 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-024'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-024/TF-AWM-024-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-024/TF-AWM-024-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 24 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-024'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-024/TF-AWM-024-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-024/TF-AWM-024-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 24 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-024'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-024/TF-AWM-024-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-025', 'automatic-washer-door-lock-model-25', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 25', 'قفل أمان باب بتصميم طويل وهيكل بلاستيكي أسود وأبيض مع جزء داخلي بني، مدخل مستطيل للسان الباب في الأعلى، وقاعدة علوية تضم أربع فتحات دائرية لاختيار موضع التثبيت. مزود بفيشة جانبية بنية تضم 3 أطراف توصيل معدنية مرقمة 1 و3 و2. تظهر على القطعة المواصفات ZV-446 و250V~ T110 و16(6)A CLOSING و10(4)A OPENING، والمرجع 72805310400. يُرجى قبل الطلب مقارنة شكل القطعة وأبعادها، اتجاه مدخل اللسان، فتحات التثبيت، شكل الفيشة وعدد أطرافها وترتيبها مع القفل والفيشة الأصليين والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 50, 80,
  500, 'published', 25
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-025/TF-AWM-025-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 25 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-025'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-025/TF-AWM-025-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-025/TF-AWM-025-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 25 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-025'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-025/TF-AWM-025-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-025/TF-AWM-025-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 25 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-025'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-025/TF-AWM-025-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-026', 'automatic-washer-door-lock-model-26', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 26', 'قفل أمان باب بتصميم طويل وهيكل بلاستيكي أبيض مع آلية علوية سوداء، مدخل مستطيل للسان الباب في الأعلى، ودليل تثبيت جانبي بارز. مزود بفيشة جانبية بيضاء تضم 3 أطراف توصيل معدنية مرقمة 1 و2 و3. تظهر على القطعة مواصفات T85 IE4 و16(6)A 250V~ CLOSING و10(2)A 250V~ OPENING. يُرجى قبل الطلب مقارنة شكل القطعة وأبعادها، اتجاه مدخل اللسان والدليل الجانبي، نقاط التثبيت، شكل الفيشة وعدد أطرافها وترتيبها مع القفل والفيشة الأصليين والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 150,
  500, 'published', 26
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-026/TF-AWM-026-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 26 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-026'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-026/TF-AWM-026-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-026/TF-AWM-026-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 26 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-026'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-026/TF-AWM-026-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-026/TF-AWM-026-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 26 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-026'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-026/TF-AWM-026-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-027', 'automatic-washer-door-lock-model-27', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 27', 'قفل أمان باب بهيكل بلاستيكي أسود عريض، مدخل جانبي مستطيل للسان الباب، وآلية ميكانيكية جانبية مع ذراع بارز وعدة نقاط للتثبيت. مزود بوحدة كهربائية بيضاء وفيشة مدمجة تضم 3 أطراف توصيل معدنية مرقمة 3 و2 و1. تظهر على القطعة العلامة Metalflex والطراز ZV-447، والمرجعان V13305 و0024000128D، إضافة إلى المواصفة T85 IE4 و1-2 16(6)A 250VAC. يُرجى قبل الطلب مقارنة شكل القطعة وأبعادها، اتجاه مدخل اللسان والذراع، نقاط التثبيت، شكل الفيشة وعدد أطرافها وترتيبها والمراجع المكتوبة مع القفل والفيشة الأصليين والصور لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 90, 140,
  500, 'published', 27
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-027/TF-AWM-027-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 27 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-027'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-027/TF-AWM-027-1.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-027/TF-AWM-027-2.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 27 - صورة 2', 2, false
from public.products p
where p.sku = 'TF-AWM-027'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-027/TF-AWM-027-2.jpg'
);

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-027/TF-AWM-027-3.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 27 - صورة 3', 3, false
from public.products p
where p.sku = 'TF-AWM-027'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-027/TF-AWM-027-3.jpg'
);

insert into public.products (
  sku, slug, category_id, name_ar, description_ar,
  unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
  stock_quantity, status, sort_order
) values (
  'TF-AWM-028', 'automatic-washer-door-lock-model-28', 16, 'قفل أمان باب مكينة الصابون الأوتوماتيكية – موديل 28', 'قفل أمان باب بهيكل مركب من وحدة كهربائية بلاستيكية رمادية وآلية قفل سوداء، مع مدخل مستطيل جانبي للسان الباب وقاعدة سوداء تضم نقطتي تثبيت دائريتين. مزود بفيشة مدمجة تظهر عليها أرقام أطراف التوصيل 2 و3 و5. تظهر على القطعة العلامة ROLD وعبارة DF SERIES، إضافة إلى المواصفات 4-5 16(6)A 250V~ وIE4 وT85. يُرجى قبل الطلب مقارنة شكل القطعة وأبعادها، اتجاه مدخل اللسان، مواضع التثبيت، شكل الفيشة وأرقام وترتيب أطرافها والمواصفات المكتوبة مع القفل والفيشة الأصليين والصورة لضمان التوافق.

لضمان التوافق، قارن القطعة الأصلية مع جميع الصور، خصوصاً شكل الهيكل، والفيشة، وعدد وترتيب أطراف التوصيل، ولسان القفل، ومواضع التثبيت. الاعتماد على شكل الماكينة وحده غير كافٍ.',
  'قطعة', 1, 1, 70, 150,
  500, 'published', 28
)
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
select p.id, 'product-images/TF-AWM-028/TF-AWM-028-1.jpg', 'قفل باب مكينة الصابون الأوتوماتيكية موديل 28 - صورة 1', 1, true
from public.products p
where p.sku = 'TF-AWM-028'
and not exists (
  select 1 from public.product_images pi
  where pi.product_id = p.id and pi.storage_path = 'product-images/TF-AWM-028/TF-AWM-028-1.jpg'
);
