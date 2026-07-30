-- نشر كل المنتجات الموجودة (draft -> published) وضبط مخزون موحّد 500
-- لكل منتج، بموافقة صريحة من العميل. لا تغيير على الاسم أو الثمن أو
-- الصورة أو التصنيف أو الوصف أو الحد الأدنى للطلب.

update public.products set stock_quantity = 500;

-- المتغيرات (product_variants) لها مخزونها الخاص المنفصل عن المنتج الأب —
-- إذا بقي 0، يبقى المتغير "غير متوفر للطلب" رغم أن المنتج نفسه published
-- بمخزون 500. نفس المعاملة هنا حتى تصبح كل المتغيرات قابلة للطلب فعلاً.
update public.product_variants set stock_quantity = 500;

update public.products set status = 'published' where status = 'draft';
