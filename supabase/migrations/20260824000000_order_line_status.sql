-- حالة مستقلة لكل سطر في الطلب.
--
-- قبل هذا، إنشاء الطلب كان ذرّياً بالكامل: سطر واحد لا يُحجز مخزونه يُسقط
-- الطلب كلَّه. قِسنا الأثر على سلة حقيقية من 154 منتجاً (23.119 درهم):
-- منتج واحد نفد مخزونه ألغى 154 سطراً، ولأن الزبون كان قد غادر إلى واتساب
-- لم يرَ أحدٌ الرفضَ — وصلت الطلبية إلى واتساب ولم يبقَ منها أثر في اللوحة.
--
-- الآن يُحفظ الطلب كما اختاره الزبون كاملاً، ولكل سطر حالته وسببه:
--   reserved     حُجز مخزونه فعلاً
--   out_of_stock الكمية غير متوفرة الآن
--   invalid      مرفوض لسبب آخر (كمية دون الحدّ الأدنى، منتج غير متاح…)
-- المخزون يُخصم للسطور المحجوزة وحدها، والسطر المرفوض يبقى ظاهراً باسمه
-- وكميته وسببه بدل أن يختفي.

alter table public.order_items
  add column if not exists line_status text not null default 'reserved';

alter table public.order_items
  add column if not exists line_status_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_line_status_check'
  ) then
    alter table public.order_items
      add constraint order_items_line_status_check
      check (line_status in ('reserved', 'out_of_stock', 'invalid'));
  end if;
end $$;

comment on column public.order_items.line_status is
  'reserved = حُجز مخزونه · out_of_stock = غير متوفر · invalid = مرفوض لسبب آخر';
comment on column public.order_items.line_status_reason is
  'سبب الرفض بالعربية كما يُعرض في لوحة الإدارة — فارغ للسطور المحجوزة';

-- حالة طلب جديدة: فيه سطر أو أكثر يحتاج مراجعة قبل التجهيز.
--
-- نُعيد بناء القيد بالقائمة الكاملة لا بإضافة قيمة واحدة: بعض البيئات ينقصها
-- 'returned' (هجرة 20260804000000 لم تُطبَّق عليها)، فإعادة البناء توحّدها كلها.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in (
    'new', 'needs_review', 'confirmed', 'preparing',
    'shipped', 'delivered', 'cancelled', 'returned'
  ));

create index if not exists order_items_line_status_idx
  on public.order_items (order_id)
  where line_status <> 'reserved';
