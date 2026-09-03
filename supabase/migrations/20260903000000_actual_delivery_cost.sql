-- ما دفعناه نحن لشركة التوصيل — مقابل `delivery_fee` الذي دفعه الزبون.
--
-- العمودان يبدوان متشابهين وليسا كذلك إطلاقاً، وهذا سبب وجود هذا الملف:
--
--   delivery_fee          إيراد — ما حصّلناه من الزبون مع ثمن البضاعة.
--   actual_delivery_cost  مصروف — ما دفعناه للشركة التي أوصلت الطرد.
--
-- وهما يفترقان في أغلب الطلبات لا في أقلّها: الزبون يدفع 30 والشركة تأخذ
-- 45، أو التوصيل مجاني للزبون ونتحمّله كاملاً، أو نتقاسمه. بلا هذا العمود
-- كان «صافي الربح» في صفحة التقارير يجمع إيراد التوصيل ولا يطرح تكلفته
-- أبداً، أي ربح أعلى من الحقيقي بفارق التوصيل في كل طلب.
--
-- **NULL هنا يعني «غير مسجَّلة» ولا يعني صفراً.** الفرق بينهما مالي لا
-- شكلي: صفرٌ ادّعاءٌ بأن التوصيل لم يكلّفنا شيئاً، وهو ادّعاء كاذب في كل
-- طلب سُلِّم فعلاً. لذلك لا DEFAULT هنا، ولا backfill لأي طلب قديم — تكلفة
-- التوصيل الحقيقية لتلك الطلبات غير موجودة في أي مكان، وتخمينها يُفسد
-- الأرقام بهدوء بدل أن يتركها ناقصة بوضوح. والتقارير تعدّ هذه الطلبات
-- وتعرض عددها، ولا تُدخلها في المجاميع كأنها أصفار.
alter table public.orders
  add column if not exists actual_delivery_cost numeric(10,2);

-- تكلفة سالبة لا معنى لها (شركة التوصيل لا تدفع لنا)، والسقف يمنع خطأ
-- إدخال بخانة زائدة من أن يقلب تقرير شهر كامل.
alter table public.orders
  drop constraint if exists orders_actual_delivery_cost_check;
alter table public.orders
  add constraint orders_actual_delivery_cost_check
  check (actual_delivery_cost is null or (actual_delivery_cost >= 0 and actual_delivery_cost <= 9999999));

comment on column public.orders.actual_delivery_cost is
  'المبلغ المدفوع فعلياً لشركة التوصيل (مصروف). NULL = غير مسجَّلة، وليس صفراً. يقابله delivery_fee وهو المحصَّل من الزبون (إيراد).';

-- التقارير تسأل دائماً «المسلَّمة التي لها تكلفة مسجَّلة» — فهرس جزئي صغير
-- يخدم ذلك بالضبط بدل مسح الجدول.
create index if not exists orders_actual_delivery_cost_recorded_idx
  on public.orders (status, created_at)
  where actual_delivery_cost is not null;
