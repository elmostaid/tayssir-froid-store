-- المرحلة 2A: مرجع طلب عام عشوائي غير قابل للتخمين + تحسينات فهارس
-- ملاحظة: لا نُعدِّل ملفات هجرة المرحلة الأولى (مطبَّقة فعلاً)؛ هذا ملف
-- إضافي يُطبَّق فوقها.

-- ---------------------------------------------------------------------------
-- مرجع الطلب العام (public_reference)
-- order_number (من المرحلة 1) تسلسلي وداخلي فقط (لوحة الإدارة لاحقاً)، ولا
-- يجب أبداً عرضه للزبون لأنه قابل للتخمين (رقم متتالٍ يكشف حجم الطلبات).
-- public_reference عشوائي (~40 بت عبر gen_random_uuid المدمجة في Postgres
-- 13+، بدون الحاجة لأي extension) وهو ما يُعرض للزبون ويُستعمل في رابط
-- صفحة النجاح ورسالة واتساب.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column public_reference text;

update public.orders
set public_reference = 'TF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where public_reference is null;

alter table public.orders
  alter column public_reference set not null,
  add constraint orders_public_reference_unique unique (public_reference);

create or replace function public.generate_order_public_reference()
returns trigger as $$
begin
  if new.public_reference is null then
    new.public_reference := 'TF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  end if;
  return new;
end;
$$ language plpgsql;

create trigger orders_generate_public_reference
  before insert on public.orders
  for each row execute function public.generate_order_public_reference();

create index orders_public_reference_idx on public.orders(public_reference);

-- ---------------------------------------------------------------------------
-- تحسينات فهارس المنتجات
-- ---------------------------------------------------------------------------
-- products_slug_idx كان مكرراً: عمود slug أصلاً unique ويملك فهرساً تلقائياً.
drop index if exists public.products_slug_idx;

-- فهرس مركّب يطابق نمط استعلامات الواجهة الفعلي تماماً:
-- "where status = 'published' order by created_at desc"
create index products_status_created_at_idx
  on public.products(status, created_at desc);
