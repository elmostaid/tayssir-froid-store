-- تنظيف التصنيفات التجريبية القديمة من المرحلة الأولى بعد إضافة التصنيفات
-- الحقيقية الـ13. تحقّق يدوي سابق أكّد أن كل منتج داخل هذه التصنيفات
-- تجريبي (SKU يبدأ بـ DEMO-) ولا يوجد أي منتج حقيقي فيها. الحذف هنا محصور
-- بمنتجات DEMO- داخل هذه التصنيفات فقط، ثم حذف التصنيفات نفسها. قيد
-- on delete restrict على products.category_id يمنع حذف أي تصنيف ما دام
-- يحتوي منتجاً لم يُحذف، فيفشل هذا الملف بوضوح بدل حذف تصنيف فيه منتج
-- حقيقي بالخطأ.
-- ملاحظة: تصنيف "أدوات ومعدات تبريد عامة" (cooling-tools) ومنتجه
-- التجريبي DEMO-003 غير مشمولين هنا عمداً — لم يُطلب حذفهما.

delete from public.products
where sku like 'DEMO-%'
  and category_id in (
    select id from public.categories
    where slug in ('washing-machine-parts', 'refrigerator-parts', 'freezer-parts', 'ac-parts')
  );

delete from public.categories
where slug in ('washing-machine-parts', 'refrigerator-parts', 'freezer-parts', 'ac-parts');
