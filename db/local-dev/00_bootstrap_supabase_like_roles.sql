-- هذا الملف لأغراض التطوير المحلي فقط — لا يُطبَّق أبداً على مشروع Supabase
-- الحقيقي (Supabase ينشئ هذه الأدوار وschema auth تلقائياً بنفسه).
-- الهدف هنا فقط تمكين اختبار ملفات supabase/migrations كما هي محلياً،
-- عبر محاكاة الأدوار الأساسية (anon, authenticated) وجدول auth.users.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- محاكاة auth.uid() الذي توفره Supabase تلقائياً لربط RLS بالمستخدم المسجل دخوله
create or replace function auth.uid() returns uuid as $$
  select null::uuid;
$$ language sql stable;
