-- تفعيل RLS على stock_movements (أُضيف الجدول في ملف الهجرة السابق
-- orders_admin_phase13 دون أن يُشمل بنفس معاملة الأمان security.sql التي
-- سبقته زمنياً، لذا يبقى بلا RLS حتى الآن) + نفس سياسة "المدير فقط" المطبَّقة
-- على بقية الجداول الأصلية في security.sql.

alter table public.stock_movements enable row level security;

create policy admin_full_access_stock_movements on public.stock_movements
  for all to authenticated
  using (exists (select 1 from public.admin_profiles a where a.id = auth.uid()))
  with check (exists (select 1 from public.admin_profiles a where a.id = auth.uid()));
