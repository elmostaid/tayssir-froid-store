-- حدث شراء واحد لكل طلب — قيد في القاعدة لا اتفاق في الكود.
--
-- الشراء صار يُكتب من الخادم داخل نفس معاملة إنشاء الطلب، فالتكرار مستحيل
-- منطقياً أصلاً. هذا الفهرس هو الضمانة الأخيرة: لو استعاد أحد المسار القديم
-- من المتصفح، أو أُعيد تشغيل كتابة قديمة، يرفضه Postgres بدل أن يُضاعف
-- الإيراد في اللوحة بصمت.
--
-- جزئي عمداً: لا يمسّ أي حدث آخر، ولا الصفوف التي لا order_id لها.
create unique index if not exists analytics_events_one_purchase_per_order_idx
  on public.analytics_events (order_id)
  where event_name = 'purchase' and order_id is not null;
