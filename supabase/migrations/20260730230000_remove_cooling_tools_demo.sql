-- حذف آخر بيانات تجريبية من المرحلة الأولى: المنتج DEMO-003 وتصنيفه
-- "أدوات ومعدات تبريد عامة" (cooling-tools). التصنيفات الحقيقية الـ13
-- المُضافة سابقاً لا علاقة لها بهذا التصنيف (parent_id مستقل لكل منها)
-- فتبقى كما هي دون أي تأثير.

delete from public.products
where sku = 'DEMO-003'
  and category_id in (
    select id from public.categories where slug = 'cooling-tools'
  );

delete from public.categories
where slug = 'cooling-tools';
