-- إضافة "صورة مجمَّدة" (snapshot) لثمن الشراء وقت إنشاء الطلب
--
-- المشكلة: order_items يخزّن unit_price_snapshot (ثمن البيع وقت الطلب) لكن
-- لا يخزّن ثمن الشراء وقتها. كل حسابات COGS/الربح فـadminReports.ts كانت
-- تعتمد إذن على purchase_price/purchase_price_override **الحالي** فالمنتج،
-- فيتغيّر ربح طلب قديم مسلَّم بأثر رجعي كل مرة يُعدَّل فيها ثمن شراء منتج —
-- سلوك غير صحيح محاسبياً (الربح التاريخي يجب أن يبقى ثابتاً بمجرد التسليم).
--
-- الحل: عمود purchase_price_snapshot جديد، يُملأ فقط من كود الخادم وقت
-- إنشاء الطلب (createOrder.ts) بالقيمة الفعلية المستعملة وقتها:
-- variant.purchase_price_override إن وُجد، وإلا product.purchase_price.
--
-- عمود سري (نفس حساسية purchase_price نفسها) — order_items أصلاً بدون أي
-- policy عامة (RLS مفعَّل، فقط admin_full_access_order_items للمدير
-- المسجَّل)، فلا تغيير أمني إضافي مطلوب هنا.
--
-- الطلبات الموجودة سابقاً (قبل هذه الهجرة) تبقى بقيمة NULL فـهذا العمود —
-- **لا backfill تخميني هنا**: لا يوجد أي مصدر بيانات موثوق لثمن الشراء
-- الفعلي وقت تلك الطلبات القديمة (فقط الحالي، وهو بالضبط ما كنا نتجنبه).
-- طبقة التقارير (adminReports.ts) تتعامل مع NULL بالرجوع لثمن الشراء
-- الحالي كـ"تقدير تاريخي" (historical approximation) موسوم بوضوح فـالواجهة،
-- وليس كقيمة دقيقة.
alter table public.order_items
  add column purchase_price_snapshot numeric(10,2);

comment on column public.order_items.purchase_price_snapshot is
  'ثمن الشراء الفعلي وقت إنشاء الطلب (variant.purchase_price_override إن وُجد، وإلا product.purchase_price). NULL للطلبات السابقة لهذه الهجرة — طبقة التقارير تستعمل ثمن الشراء الحالي كتقدير تاريخي فهذه الحالة فقط.';
