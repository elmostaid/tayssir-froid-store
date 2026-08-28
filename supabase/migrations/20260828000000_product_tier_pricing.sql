-- ---------------------------------------------------------------------------
-- التسعير المتدرِّج المرن (Flexible Tier Pricing) على مستوى المنتج
--
-- هذه الهجرة **إضافية بحتة**: لا تحتوي أي UPDATE ولا backfill ولا أي مساس
-- بـorder_items أو orders. كل منتج موجود حالياً يبقى بنفس ثمنه وبنفس
-- min_order_qty بالضبط، لأن pricing_mode الافتراضي 'single' يعني حرفياً
-- "استعمل sale_price لكل الكميات" — وهو السلوك الحالي نفسه بلا أي فرق.
--
-- ملاحظات تصميم:
--   * sale_price يبقى هو **ثمن المستوى الأول** (ثمن القطعة). لا نضيف عمود
--     tier1_price مكرراً حتى يبقى كل الكود القديم (الـfeeds، التقارير،
--     الترتيب حسب الثمن) يعمل بلا أي تعديل.
--   * min_order_qty مستقل تماماً عن التسعير المتدرِّج ولا يتأثر به إطلاقاً:
--     منتج بـmin_order_qty=1 يمكن أن يكون له ثمن جملة يبدأ من 10.
--   * التسعير **تراجعي (retroactive)**: عند بلوغ مستوى، ثمنه الجديد يُطبَّق
--     على **كل** وحدات نفس المنتج، لا على الزائد فقط.
--   * لا تسعير متدرِّج على مستوى المتغيّرات (variants) في هذه المرحلة: إذا
--     كان للمتغيّر sale_price_override فهو يُلغي سلَّم الأثمنة كلياً ويُعامَل
--     كثمن واحد. انظر src/lib/pricing/tierPricing.ts (resolveVariantPricing).
-- ---------------------------------------------------------------------------

alter table public.products
  add column pricing_mode text not null default 'single'
    check (pricing_mode in ('single', 'two_tier', 'three_tier')),
  add column tier2_min_qty integer check (tier2_min_qty > 1),
  add column tier2_price numeric(10,2) check (tier2_price >= 0),
  add column tier3_min_qty integer check (tier3_min_qty > 1),
  add column tier3_price numeric(10,2) check (tier3_price >= 0),
  add column show_bulk_whatsapp boolean not null default false;

-- تماسك البيانات: كل نمط تسعير يفرض بالضبط الأعمدة التي يحتاجها، ولا يسمح
-- بأعمدة "يتيمة" من نمط آخر (مثلاً tier3 مملوء ونحن في two_tier).
alter table public.products
  add constraint products_pricing_mode_coherent check (
    (
      pricing_mode = 'single'
      and tier2_min_qty is null and tier2_price is null
      and tier3_min_qty is null and tier3_price is null
    )
    or (
      pricing_mode = 'two_tier'
      and tier2_min_qty is not null and tier2_price is not null
      and tier3_min_qty is null and tier3_price is null
    )
    or (
      pricing_mode = 'three_tier'
      and tier2_min_qty is not null and tier2_price is not null
      and tier3_min_qty is not null and tier3_price is not null
      and tier3_min_qty > tier2_min_qty
    )
  );

comment on column public.products.pricing_mode is
  'single = ثمن واحد لكل الكميات (السلوك الافتراضي والقديم). two_tier = ثمن الوحدة + ثمن الجملة. three_tier = + ثمن الجملة الكبيرة.';
comment on column public.products.tier2_min_qty is
  'الكمية التي يبدأ منها ثمن الجملة (المستوى الثاني). ليست ثابتة على 10 — تختلف من منتج لآخر.';
comment on column public.products.show_bulk_whatsapp is
  'إظهار رابط "باغي كمية كبيرة؟ تواصل معنا عبر واتساب" في صفحة المنتج. مستقل تماماً عن pricing_mode.';

-- ---------------------------------------------------------------------------
-- إعادة تعريف الـview العامة لتشمل أعمدة التسعير الجديدة.
-- مبنية حرفياً على آخر تعريف (20260810000000_add_product_sort_order.sql) مع
-- إضافة الأعمدة الستة **في الآخر فقط** — لأن create or replace view في
-- Postgres لا يسمح بإدراج عمود في وسط قائمة الأعمدة الموجودة.
-- الأعمدة السرية (purchase_price وأخواتها) تبقى خارج الـview كما هي.
-- ---------------------------------------------------------------------------
create or replace view public.catalog_products as
select
  p.id,
  p.sku,
  p.slug,
  p.category_id,
  c.slug as category_slug,
  c.name_ar as category_name_ar,
  p.name_ar,
  p.name_fr,
  p.description_ar,
  p.technical_specs,
  p.unit_label,
  p.min_order_qty,
  p.qty_increment,
  p.sale_price,
  p.stock_quantity,
  p.meta_title,
  p.meta_description,
  p.created_at,
  (
    select pi.storage_path
    from public.product_images pi
    where pi.product_id = p.id
    order by pi.is_primary desc, pi.sort_order asc
    limit 1
  ) as primary_image_path,
  p.status,
  p.sort_order,
  p.pricing_mode,
  p.tier2_min_qty,
  p.tier2_price,
  p.tier3_min_qty,
  p.tier3_price,
  p.show_bulk_whatsapp
from public.products p
join public.categories c on c.id = p.category_id
where p.status in ('published', 'out_of_stock') and c.is_active = true;

-- ---------------------------------------------------------------------------
-- الـview الحالية للمتغيّرات تُرجع coalesce(v.sale_price_override, p.sale_price)
-- فتضيع معها المعلومة الحاسمة: هل للمتغيّر ثمن خاص فعلاً أم أنه يرث ثمن
-- المنتج الأب؟ نحتاجها بالضبط لتطبيق القاعدة المذكورة أعلاه (ثمن خاص =>
-- ثمن واحد بلا سلَّم أثمنة). نضيف has_price_override في الآخر، بلا أي تغيير
-- على الأعمدة الموجودة أو على قيمها.
-- ---------------------------------------------------------------------------
create or replace view public.catalog_product_variants as
select
  v.id,
  v.product_id,
  v.variant_name,
  coalesce(v.sale_price_override, p.sale_price) as sale_price,
  v.stock_quantity,
  coalesce(v.min_order_qty_override, p.min_order_qty) as min_order_qty,
  coalesce(v.qty_increment_override, p.qty_increment) as qty_increment,
  v.sort_order,
  (v.sale_price_override is not null) as has_price_override
from public.product_variants v
join public.products p on p.id = v.product_id
where v.is_active = true and p.status = 'published';
