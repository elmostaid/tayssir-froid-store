-- نشر 3 منتجات فقط بموافقة صريحة من العميل (draft -> published)، دون أي
-- تعديل آخر على أي حقل أو صورة. ثمن الشراء والوصف يبقيان فارغين كما هما.

update public.products
set status = 'published'
where sku in ('TF-WM-022', 'TF-WM-023', 'TF-WM-024');
