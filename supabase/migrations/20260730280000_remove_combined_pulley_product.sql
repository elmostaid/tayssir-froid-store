-- بعد تحويل بولي 10/11/كاري إلى ثلاثة منتجات مستقلة (TF-WM-019/020/021)،
-- حذف المنتج القديم المُجمَّع TF-WM-002 نهائياً (بموافقة صريحة) لتفادي
-- التكرار في الكتالوج. متغيراته الثلاثة وصورته تُحذف تلقائياً معه
-- (on delete cascade من products إلى product_variants وproduct_images).

delete from public.products where sku = 'TF-WM-002';
