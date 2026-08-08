-- إعادة حالة "راجع" (returned) لدورة حالات الطلب — كانت موجودة أصلاً في
-- core_schema.sql وحُذفت في migration 20260803000000 قبل بداية البيع
-- الفعلي (لم تكن هناك طلبات حقيقية بعد). الآن مطلوبة صراحة: زبون يُرجع
-- سلعة بعد التسليم. تُعامَل بنفس منطق الإلغاء بالضبط من ناحية استرجاع
-- المخزون (دالة واحدة معمَّمة في الكود وليس منطقاً منفصلاً)، مع منع أي
-- استرجاع مزدوج في كلا الاتجاهين (ملغى↔راجع) — انظر actions.ts.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in (
  'new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned'
));

alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check check (reason in (
  'order_created', 'order_cancelled', 'order_returned', 'manual_adjustment'
));
