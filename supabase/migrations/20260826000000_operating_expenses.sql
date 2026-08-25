-- مصاريف التشغيل — جدول جديد بالكامل. لا يُعدَّل ولا يُقرَأ منه أي جدول قائم،
-- ولا تتغيّر أي بيانات موجودة.
--
-- ما الذي يجيب عنه: الربح الخام (المبيعات − تكلفة البضاعة) لا يقول كم بقي
-- فعلاً في الجيب. الإشهار والكراء والمازوط والأجور تُدفع من ذلك الربح ولا
-- أثر لها في أي جدول، فالرقم المعروض في اللوحة كان أكبر من الحقيقة دائماً.
--
-- ما ليس هنا عمداً: ثمن شراء البضاعة (COGS). هو مخصوم أصلاً داخل الربح
-- الخام عبر order_items.purchase_price_snapshot، فتسجيله هنا يخصمه مرتين
-- ويُظهر خسارة لا وجود لها. هذا الجدول للمصاريف التشغيلية وحدها.

create table public.operating_expenses (
  id          bigserial primary key,

  -- المبلغ بالدرهم. موجب حصراً: المصروف الصفري لا معنى له، والسالب يعني
  -- مدخولاً — وهذا الجدول لا يسجّل المداخيل.
  amount_mad  numeric(12, 2) not null check (amount_mad > 0),

  -- قائمة مغلقة في القاعدة نفسها لا في الكود وحده: تصنيف مكتوب بحرّية
  -- يُنتج «اشهار» و«إشهار» و«Ads» فيصير التجميع حسب التصنيف بلا معنى.
  category    text not null check (category in (
                'advertising',      -- إشهار
                'rent',             -- كراء
                'fuel_transport',   -- مازوط/نقل
                'wages',            -- أجور وعمال
                'packaging',        -- كرتون وتغليف
                'supplies',         -- لوازم
                'utilities',        -- ماء وكهرباء
                'other'             -- أخرى
              )),

  -- البيان: لماذا صُرف هذا المبلغ. إجباري وغير فارغ — مصروف بلا سبب
  -- مكتوب لا يمكن مراجعته بعد شهر.
  description text not null check (length(btrim(description)) between 1 and 200),

  -- تاريخ وقوع المصروف، لا تاريخ تسجيله. عمود date لا timestamptz: المصروف
  -- يقع في يوم، والتقارير تُصفّى بأيام محلية — فلا حاجة لساعة ولا لمنطقة
  -- زمنية، ولا خطر أن ينزلق مصروف إلى اليوم السابق بفارق الإزاحة.
  spent_on    date not null default current_date,

  note        text check (note is null or length(note) <= 500),

  -- من سجّله — للمراجعة لا أكثر.
  created_by  text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- كل استعلامات التقرير من الشكل «مجموع المصاريف بين يومين»، فالفهرس
-- الزمني هو الوحيد المطلوب فعلاً.
create index operating_expenses_spent_on_idx
  on public.operating_expenses (spent_on desc, id desc);

-- تجميع حسب التصنيف داخل مدى زمني.
create index operating_expenses_category_idx
  on public.operating_expenses (category, spent_on desc);

-- RLS مُفعَّل بلا أي سياسة — نفس نمط analytics_events بالضبط: كل قراءة
-- وكتابة تمرّ عبر اتصال الخادم المباشر (DATABASE_URL) من صفحات /admin
-- المحمية بـisOwnerAdmin. لا anon key ولا authenticated يبلغ هذا الجدول
-- عبر PostgREST إطلاقاً، فمصاريف المشروع لا تتسرّب إلى أي واجهة عامة.
alter table public.operating_expenses enable row level security;

comment on table public.operating_expenses is
  'مصاريف تشغيل المشروع (إشهار، كراء، نقل…). تُطرَح من الربح الخام لحساب صافي الربح. لا تشمل ثمن شراء البضاعة — ذاك مخصوم أصلاً في الربح الخام.';
