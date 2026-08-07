-- إضافة إعدادات جديدة قابلة للتعديل من لوحة الإدارة (/admin/settings) بلا
-- تغيير أي كود لاحقاً: اسم المتجر، قالب رسالة واتساب المرتبطة بالطلب،
-- تفعيل/تعطيل استقبال طلبات جديدة (الدفع عند الاستلام هو الطريقة الوحيدة
-- المتوفرة فعلياً، فهذا المفتاح يعمل كإيقاف مؤقت لاستقبال الطلبات — انظر
-- الشرح الكامل فـ src/lib/queries/settings.ts وcreateOrder.ts).
insert into public.settings (key, value) values
  ('store_name', to_jsonb('Tayssir Froid'::text)),
  ('whatsapp_order_message_template', to_jsonb('مرحباً، بخصوص طلبكم رقم {orderNumber} في {storeName}.'::text)),
  ('cod_enabled', to_jsonb(true))
on conflict (key) do nothing;
