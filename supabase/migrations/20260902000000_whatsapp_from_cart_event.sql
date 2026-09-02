-- حدث قياس ثامن: `whatsapp_from_cart`.
--
-- المتجر يُنهي كل طلب على واتساب أصلاً — زر «إرسال الطلب عبر واتساب» فآخر
-- نموذج إتمام الطلب. لكن الوصول إليه يمرّ بثلاثة حقول إجبارية (الاسم،
-- الهاتف، المدينة)، وهذا ما تقيسه الأرقام كأكبر تسرّب متبقٍّ: من 9 أيام،
-- 40 جلسة بدأت الطلب من متصفّح فيسبوك الداخلي وأنهته 8 فقط (20%)، مقابل
-- 60% من متصفّح إنستغرام و33% من كروم. والمالك نفسه أنهى ثلاثة طلبات
-- يدوياً على واتساب فليلة واحدة بـ7,751 درهم — بلا نموذج إطلاقاً.
--
-- فالمسار الجديد يبدأ الطلب على واتساب من السلة مباشرة، بلا حقول. وحتى
-- نعرف هل ينجح فعلاً أم يسحب فقط من مسار قائم، يلزم حدث يفصله عن غيره:
-- Carts → Checkout → **WhatsApp-from-cart** → Real Orders.
--
-- القائمة مغلقة عمداً فثلاثة مواضع متطابقة (lib/analytics/events.ts،
-- التحقّق فـ/api/analytics، وهذا القيد)، فتوسيعها يقع فالثلاثة معاً.
alter table public.analytics_events drop constraint if exists analytics_events_event_name_check;
alter table public.analytics_events add constraint analytics_events_event_name_check
  check (event_name in (
    'session_start',
    'landing_page_view',
    'product_view',
    'add_to_cart',
    'cart_view',
    'begin_checkout',
    'whatsapp_from_cart',
    'purchase'
  ));
