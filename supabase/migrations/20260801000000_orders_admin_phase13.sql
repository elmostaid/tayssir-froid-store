-- المرحلة 13: نظام الطلبيات الأوتوماتيكي (لوحة إدارة + حجز مخزون + بون تحضير)
-- ملاحظة: لا نُعدِّل ملفات هجرة سابقة (مطبَّقة فعلاً)؛ هذا ملف إضافي فوقها.

-- ---------------------------------------------------------------------------
-- إضافة حالة "ready" (جاهز للشحن) إلى قائمة حالات الطلب المسموحة، دون حذف
-- أي حالة موجودة مسبقاً (contacted/returned تبقيان متاحتين للمرونة مستقبلاً).
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in (
  'new', 'contacted', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'returned', 'cancelled'
));

-- ---------------------------------------------------------------------------
-- حجز المخزون: يُنقَص stock_quantity عند إنشاء الطلب مباشرة (وليس عند
-- التأكيد اليدوي لاحقاً)، ويُعاد عند إلغاء الطلب. كل حركة مسجَّلة هنا حتى
-- يمكن تتبع أي تغيير في المخزون ناتج عن الطلبات (وليس فقط تعديل يدوي).
-- ---------------------------------------------------------------------------
create table public.stock_movements (
  id bigint generated always as identity primary key,
  product_id bigint references public.products(id) on delete set null,
  variant_id bigint references public.product_variants(id) on delete set null,
  order_id bigint references public.orders(id) on delete set null,
  quantity_delta integer not null, -- سالب = إنقاص (حجز عند الطلب)، موجب = إرجاع (عند الإلغاء)
  reason text not null check (reason in ('order_created', 'order_cancelled', 'manual_adjustment')),
  created_at timestamptz not null default now()
);

create index stock_movements_product_id_idx on public.stock_movements(product_id);
create index stock_movements_order_id_idx on public.stock_movements(order_id);
