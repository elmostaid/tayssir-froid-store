-- يضيف عمود disabled_at لتعطيل وصول حساب إداري (Staff عادةً) إلى لوحة
-- الإدارة دون حذف حسابه فـSupabase Auth ولا صفه فـadmin_profiles — تعطيل
-- عكوس (reversible)، بخلاف الحذف الكامل (الذي يُنفَّذ من كود الخادم عبر
-- Supabase Auth Admin API + حذف الصف معاً).
--
-- NULL (الافتراضي) يعني حساباً نشطاً — الحسابات الموجودة حالياً (الحساب
-- الحقيقي الوحيد المعروف) لا تتأثر إطلاقاً، تبقى نشطة كما هي دون أي تغيير.
--
-- ⚠️ يجب تطبيق هذه الهجرة يدوياً على Supabase Production (SQL Editor أو
-- supabase db push) — لا يوجد أي تطبيق تلقائي للهجرات في هذا المشروع.
alter table public.admin_profiles
  add column disabled_at timestamptz;

comment on column public.admin_profiles.disabled_at is
  'وقت تعطيل وصول هذا الحساب إلى لوحة الإدارة (NULL = نشط). getAdminUser() يعامل أي صف بقيمة غير NULL هنا كأنه غير موجود إطلاقاً — نفس أثر عدم وجود صف بـadmin_profiles.';
