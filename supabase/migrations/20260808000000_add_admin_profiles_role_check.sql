-- يضيف قيداً (CHECK) على admin_profiles.role يقصره على 'admin' أو 'staff'.
--
-- عمود role موجود أصلاً منذ core_schema.sql (نص حر، افتراضي 'admin')، بدون
-- أي قيد سابقاً. هذه الهجرة لا تُغيّر أي بيانات موجودة ولا تحذف شيئاً —
-- الحساب الحقيقي الوحيد المعروف (smailmostaid123@gmail.com، عبر migration
-- 20260803020000) قيمته role='admin' بالفعل، فيطابق القيد الجديد دون أي
-- تعديل. أي حساب Staff جديد يُربَط لاحقاً (يدوياً، بنفس أسلوب ربط الحساب
-- الحالي) يجب أن يحمل role='staff' بالضبط ليحصل على الصلاحيات المحدودة —
-- انظر src/lib/auth/requireAdmin.ts (أي قيمة غير 'admin' تُعامَل بصفتها
-- staff تلقائياً، fail-closed).
--
-- ⚠️ يجب تطبيق هذه الهجرة يدوياً على Supabase Production (SQL Editor أو
-- supabase db push) — لا يوجد أي تطبيق تلقائي للهجرات في هذا المشروع.
alter table public.admin_profiles
  add constraint admin_profiles_role_check check (role in ('admin', 'staff'));
