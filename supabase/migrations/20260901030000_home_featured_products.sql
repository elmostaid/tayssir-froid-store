-- «الأكثر طلباً» يصير اختياراً وترتيباً يدويين من لوحة الإدارة.
--
-- القسم وُلد بقائمة أكواد مكتوبة فالكود (lib/catalog/topDemand.ts) مبنية على
-- قياس أسبوع من analytics_events. القياس صحيح، لكن صاحب المتجر يعرف عن
-- سلعته ما لا يعرفه أسبوع واحد من الأرقام (موسم، صفقة، مخزون راكد يريد
-- تصريفه)، ولا يجب أن ينتظر تعديل كود ليغيّر واجهة متجره.
--
-- **ترتيب مستقل تماماً عن products.sort_order** عمداً: ذاك رقم المنتج داخل
-- تصنيفه ويحكم صفحة التصنيف و«جميع المنتجات»، وربط الواجهة به كان سيعني أن
-- رفع منتج إلى صدر الصفحة الرئيسية يُزيحه من مكانه داخل تصنيفه أيضاً. هنا
-- جدول منفصل بترتيبه الخاص: position 1، 2، 3…
create table if not exists public.home_featured_products (
  -- product_id هو المفتاح الأساسي نفسه: منتج لا يظهر مرتين فالقسم.
  -- CASCADE لأن حذف المنتج يجب أن يُخرجه من الواجهة فوراً بلا أثر معلَّق.
  product_id bigint primary key references public.products(id) on delete cascade,
  -- بلا قيد unique عمداً: كل نقل يُعيد ترقيم القائمة كاملة 1..N فـUPDATE
  -- واحد، وقيد الوحدانية غير المؤجَّل كان سيرفض حالات وسيطة داخل نفس
  -- العبارة. الوحدانية تُضمن من منطق النقل، والترتيب يُحسم بـproduct_id عند
  -- أي تساوٍ عابر.
  position integer not null,
  created_at timestamptz not null default now()
);

create index if not exists home_featured_products_position_idx
  on public.home_featured_products (position asc, product_id asc);

-- نفس سياسة بقية جداول الإدارة: RLS مُفعَّل بلا سياسات، فلا يصل أحد الجدول
-- عبر PostgREST بالمفتاح العام. القراءة تقع من الخادم وحده.
alter table public.home_featured_products enable row level security;
