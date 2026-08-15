-- إصلاح: صور تصنيفات ومنتجات مكسورة بشكل متقطّع وغير مرتبط بهاتف واحد —
-- تأكَّد لاحقاً (بعد commit 703d65a أدناه) أن نفس الصورة قد تعمل على
-- iPhone وتنكسر على آخر، والعكس تماماً لصورة مختلفة على نفس الهاتفين. هذا
-- النمط لا يفسّره عيب بنيوي واحد فملف بعينه (فُحصت كل الملفات فرداً
-- فرداً: PNG/WebP صالحة، بلا شفافية فعلية غير متوقَّعة) بقدر ما يفسّره
-- التنسيق/التسمية غير الموحَّدة عبر الموقع نفسها — نفس فئة العطل الأولى
-- (WebP بحاوية VP8X+ICC فصور التصنيفات، 3099b0b/e8ab764)، لكن أوسع نطاقاً
-- مما ظُنّ أول مرة. الإصلاح هنا يوحّد كل صور المنتجات (دفعة
-- "product-images-v3" الحديثة، وTF-CK-* القديمة فـ"product-images") لنفس
-- القالب الآمن: JPEG baseline بلا ICC/EXIF، اسم ملف ASCII بسيط <SKU>.jpg
-- بدل الاسم العربي الأصلي المُرمَّز percent-encoding (مثال:
-- "TF-WM-040__موطور نشاف LG رأس غليظ.png"). تغيير اسم الملف نفسه — لا
-- الصيغة فقط — مقصود: يضمن طلب المتصفح رابطاً جديداً كلياً لم يُخزَّن فأي
-- ذاكرة تخزين مؤقت (محلية على الهاتف أو على شبكة توصيل المحتوى) سابقاً،
-- بدل الاعتماد على انتهاء صلاحية نسخة قديمة قد تكون معطوبة/غير مكتملة.
-- (صور التصنيفات نفسها حُوِّلت بنفس المنطق فنفس الالتزام — public/categories/
-- — لكنها ثابتة فالكود (categoryImages.ts) ولا تحتاج migration.)
--
-- هذا الجدول (product_images) هو المصدر الحقيقي الوحيد لمسار كل صورة —
-- لا يوجد عمود صورة مكرَّر في products. التحديث مطابق بالنمط (storage_path
-- LIKE) لا بقيمة كاملة ثابتة، فيبقى صحيحاً بغضّ النظر عن الاسم العربي
-- الأصلي الدقيق لكل صف. مضمون التكرار الآمن (idempotent): يستثني الصفوف
-- المطابقة أصلاً للقيمة الجديدة، فإعادة تشغيله بعد نجاحه أول مرة بلا أي أثر.
update public.product_images pi
set storage_path = 'product-images-v3/' || s.sku || '/' || s.sku || '.jpg'
from (
  select id, split_part(storage_path, '/', 2) as sku
  from public.product_images
  where storage_path like 'product-images-v3/%'
) s
where pi.id = s.id
  and pi.storage_path <> 'product-images-v3/' || s.sku || '/' || s.sku || '.jpg';

update public.product_images pi
set storage_path = 'product-images/' || s.sku || '/' || s.sku || '.jpg'
from (
  select id, split_part(storage_path, '/', 2) as sku
  from public.product_images
  where storage_path like 'product-images/TF-CK-%'
) s
where pi.id = s.id
  and pi.storage_path <> 'product-images/' || s.sku || '/' || s.sku || '.jpg';

-- صور ثانوية أقدم (product-images/<SKU>/<اسم-ASCII-أصلاً>.webp، لأصناف
-- خارج TF-CK) لا تحتاج تغيير الاسم، فقط الصيغة: WebP بسيطة (VP8 بلا ICC)
-- لكن غير موحّدة مع بقية الموقع الآن كله JPEG baseline.
update public.product_images
set storage_path = left(storage_path, length(storage_path) - 5) || '.jpg'
where storage_path like 'product-images/%.webp';
