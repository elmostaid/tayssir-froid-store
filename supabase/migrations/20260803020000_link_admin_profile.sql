-- يربط حساب Supabase Auth الحقيقي (المُنشَأ يدوياً من Dashboard، وليس من
-- هنا — كلمة المرور لا يجب أبداً أن تمر عبر الكود أو GitHub) بجدول
-- admin_profiles، وهو الشرط الوحيد الذي يتحقق منه getAdminUser() لمنح
-- صلاحية الدخول إلى /admin. يعتمد على البريد الإلكتروني فقط (وليس UUID
-- ثابتاً) ليبقى صحيحاً في أي بيئة (لا يفعل شيئاً إن لم يكن الحساب موجوداً
-- بعد في auth.users، ويمكن إعادة تشغيله بأمان لاحقاً بعد إنشائه).
insert into public.admin_profiles (id, full_name, role)
select id, 'Admin', 'admin'
from auth.users
where email = 'smailmostaid123@gmail.com'
on conflict (id) do nothing;
