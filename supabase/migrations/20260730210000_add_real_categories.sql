-- إضافة التصنيفات الحقيقية الأولى المطلوبة من العميل (عربي/فرنسي)، بنفس
-- الترتيب المطلوب. تصنيفات رئيسية (parent_id فارغ) تُضاف بعد التصنيفات
-- التجريبية الحالية في الترتيب (sort_order يتابع من حيث انتهت). الإدراج
-- محمي من التكرار بشرطين: slug فريد (unique constraint + ON CONFLICT)،
-- وفحص إضافي بالاسم العربي تحسباً لتكرار محتمل بصيغة مختلفة من slug.

insert into public.categories (slug, name_ar, name_fr, sort_order)
select v.slug, v.name_ar, v.name_fr, v.sort_order
from (
  values
    ('standard-washing-machine-parts', 'قطع غيار آلات غسيل الملابس العادية', 'Pièces détachées pour machines à laver classiques', 6),
    ('semi-automatic-washing-machine-parts', 'قطع غيار آلات غسيل الملابس نصف الأوتوماتيكية', 'Pièces détachées pour machines à laver semi-automatiques', 7),
    ('automatic-washing-machine-parts', 'قطع غيار آلات غسيل الملابس الأوتوماتيكية', 'Pièces détachées pour machines à laver automatiques', 8),
    ('refrigerator-spare-parts', 'قطع غيار الثلاجات', 'Pièces détachées pour réfrigérateurs', 9),
    ('freezer-spare-parts', 'قطع غيار المجمدات', 'Pièces détachées pour congélateurs', 10),
    ('blender-parts', 'قطع غيار خلاط العصير', 'Pièces détachées pour mixeurs', 11),
    ('pressure-cooker-parts', 'قطع غيار الكوكوط (طنجرة الضغط)', 'Pièces détachées pour cocottes-minute et autocuiseurs', 12),
    ('electric-oven-parts', 'قطع غيار الفرن الكهربائي', 'Pièces détachées pour fours électriques', 13),
    ('gas-oven-parts', 'قطع غيار الفرن الغازي', 'Pièces détachées pour fours à gaz', 14),
    ('panini-maker-parts', 'قطع غيار البانيني', 'Pièces détachées pour appareils à panini', 15),
    ('gas-water-heater-parts', 'قطع غيار سخان الماء الغازي', 'Pièces détachées pour chauffe-eau à gaz', 16),
    ('electric-water-heater-parts', 'قطع غيار سخان الماء الكهربائي', 'Pièces détachées pour chauffe-eau électriques', 17),
    ('split-ac-parts', 'قطع غيار المكيفات المنزلية سبليت', 'Pièces détachées pour climatiseurs Split résidentiels', 18)
) as v(slug, name_ar, name_fr, sort_order)
where not exists (
  select 1 from public.categories c where c.name_ar = v.name_ar
)
on conflict (slug) do nothing;
