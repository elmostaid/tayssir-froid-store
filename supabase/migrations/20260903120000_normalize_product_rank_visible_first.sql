-- إعادة ترقيم sort_order مرة واحدة: المعروض 1..V ثم المخفيّ بعده.
--
-- **لا يغيّر هذا ترتيب أي منتج على الموقع.** الترتيب النسبي محفوظ بالكامل؛
-- ما يتغيّر هو الأرقام نفسها: تُغلَق الفجوات التي كانت المسودّات تحجزها.
--
-- السبب: صفحة التصنيف تقرأ من العرض `catalog_products` الذي يستبعد
-- المسودّات والمؤرشف، بينما ترقيم المراتب كان يشمل كل صفوف الجدول. فمسودّة
-- على المرتبة 2 في تصنيف المكيفات جعلت المنتج رقم 3 يظهر ثانياً، و9 يظهر
-- ثامناً — الرقم محفوظ صحيحاً والاستعلام يرتّب صحيحاً، لكن الطرفين كانا
-- يعدّان مجموعتين مختلفتين.
--
-- بعد هذه الهجرة يصير رقم المنتج المعروض مساوياً لموضعه على صفحة تصنيفه
-- تماماً، ويصير أي انحراف لاحق خطأً ظاهراً لا التباساً صامتاً.
--
-- ترتيب الفرز مطابق حرفياً لترتيب العرض في lib/queries/catalog.ts
-- (sort_order تصاعدياً، ثم created_at تنازلياً، ثم id تنازلياً كفاصل ثابت).
with ranked as (
  select
    p.id,
    row_number() over (
      partition by p.category_id
      order by
        -- المعروض أولاً، ثم المخفيّ — بلا خلط بينهما.
        (case when p.status in ('published', 'out_of_stock') then 0 else 1 end) asc,
        p.sort_order asc,
        p.created_at desc,
        p.id desc
    )::int as rn
  from public.products p
)
update public.products p
set sort_order = r.rn
from ranked r
where p.id = r.id
  and p.sort_order is distinct from r.rn;
