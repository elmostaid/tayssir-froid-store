-- إرجاع المخزون الذي خصمته الطلبات المحذوفة ولم يُعَد.
--
-- الطلبات المعنية طلبات تجريبية أنشأها صاحب المتجر ثم حذفها؛ الحذف خصم
-- مخزونها ولم يُرجعه (انظر الهجرة السابقة). القياس على الإنتاج قبل التصحيح:
-- 354 حركة يتيمة عبر 145 منتجاً، صافي 2,097 وحدة مخصومة.
--
-- **قابلة لإعادة التشغيل بلا مضاعفة**، وهذا ليس ادّعاءً: التصحيح يُكتب نفسه
-- حركةَ مخزون بسبب 'order_deleted'، وهو داخل نفس المجموع المحسوب أدناه.
-- فبعد التشغيل الأول يصير صافي كل منتج صفراً، ويستبعده شرط `> 0`. وعلى
-- قاعدة نظيفة (CI) لا حركات يتيمة أصلاً فلا تفعل شيئاً.
with net as (
  select
    product_id,
    variant_id,
    -sum(quantity_delta) as restore_units
  from public.stock_movements
  where order_id is null
    and product_id is not null
    -- 'manual_adjustment' مستبعد عمداً: تلك تسويات جرد مقصودة من الإدارة،
    -- لا خصماً ناتجاً عن حذف طلب، وإرجاعها يفسد جرداً صحيحاً.
    and reason in ('order_created', 'order_cancelled', 'order_deleted')
  group by product_id, variant_id
  -- الموجب وحده يُرجَع. الصافي السالب يعني إرجاعاً زائداً قديماً؛ خصمُه
  -- الآن سيأخذ من المخزون بناءً على اختلال لا نعرف أصله — والامتناع أسلم.
  having -sum(quantity_delta) > 0
),
logged as (
  insert into public.stock_movements (product_id, variant_id, order_id, quantity_delta, reason)
  select product_id, variant_id, null, restore_units, 'order_deleted' from net
  returning 1
),
variants_fixed as (
  update public.product_variants v
     set stock_quantity = v.stock_quantity + n.restore_units
    from net n
   where n.variant_id is not null and v.id = n.variant_id
  returning 1
)
update public.products p
   set stock_quantity = p.stock_quantity + n.restore_units
  from net n
 where n.variant_id is null and p.id = n.product_id;
