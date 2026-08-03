-- تبسيط نظام الطلبات قبل انطلاق البيع الفعلي: تثبيت 6 حالات فقط (المطلوبة
-- صراحة الآن)، وتصحيح صيغة رقم الطلب لتتضمن السنة (TF-2026-0001) بدل
-- الصيغة السابقة بدون سنة (TF-000001). لا توجد طلبات حقيقية بعد (المشروع لم
-- يبدأ البيع)، فالتغيير آمن دون أي ترحيل بيانات.

-- ---------------------------------------------------------------------------
-- تقليص حالات الطلب إلى الست المطلوبة فقط: جديد، تم التأكيد، قيد التجهيز،
-- تم الإرسال، تم التسليم، ملغى. حذف contacted/ready/returned (لم تعد جزءاً
-- من دورة الحالات المعتمدة حالياً).
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in (
  'new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'
));

-- ---------------------------------------------------------------------------
-- رقم الطلب: TF-{السنة الحالية}-{4 أرقام} بدل TF-{6 أرقام} بدون سنة. نفس
-- التسلسل العددي (order_number_seq) يستمر بدون إعادة تصفير سنوي (تبسيطاً —
-- حجم الطلبات المتوقَّع صغير، وإعادة التصفير كل سنة تتطلب جدول عدادات
-- منفصلاً وقفلاً إضافياً لا يستحقان التعقيد الآن).
-- ---------------------------------------------------------------------------
create or replace function public.generate_order_number()
returns trigger as $$
begin
  if new.order_number is null then
    new.order_number := 'TF-' || extract(year from now())::text || '-' ||
      lpad(nextval('public.order_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;
