import Script from "next/script";
import { GA_MEASUREMENT_ID, isAnalyticsEnabled } from "@/lib/analytics/config";

/**
 * «وسم Google» الأساسي (gtag.js) لـGoogle Analytics 4 — هو نفسه المقتطف
 * الرسمي الذي تعطيه Google حرفياً، منقولاً إلى next/script بدل وسمَي
 * <script> خامَّين، وهي الطريقة الرسمية في App Router (نفس أسلوب
 * MetaPixel.tsx فهذا المشروع).
 *
 * strategy="afterInteractive" هي ما يوصي به توثيق Next نفسه صراحةً
 * للتحليلات ومديري الوسوم: السكريبت يُحمَّل بعد الترطيب فلا يزاحم أول رسم
 * للصفحة على شبكة ضعيفة، ويبقى مبكّراً بما يكفي لتسجيل الزيارة. (نفس دور
 * async في المقتطف الأصلي، لكن مُدار من Next.)
 *
 * وسم أساسي فقط ولا شيء غيره: gtag('js') + gtag('config') وحدهما. لا أحداث
 * مخصّصة، ولا متتبّع تنقّل يدوي — GA4 يلتقط تنقّلات App Router من جهته عبر
 * «القياس المحسَّن» (Enhanced measurement → History change)، فإضافة متتبّع
 * يدوي هنا كانت ستُنتج page_view مزدوجاً لكل تنقّل.
 *
 * مستقل تماماً عن Meta Pixel: لا يشتركان في أي حالة ولا في أي كائن عام
 * (dataLayer/gtag من جهة، fbq من جهة أخرى)، فوجود أحدهما لا يؤثِّر إطلاقاً
 * على الآخر.
 */
/**
 * إحصاء زيارات فقط — لا إشهار ولا ملف شخصي.
 *
 * مداولة CNDP D-939-2025 تُعفي من الموافقة المسبقة «إعداد إحصاءات التصفّح
 * وقياس الجمهور **دون إنشاء ملف شخصي**»، وتستثني صراحةً الإشهار المخصَّص.
 * فـGA4 هنا مقيَّد بما يبقيه داخل الإعفاء: إشارات Google (ربط الحسابات عبر
 * الأجهزة) مُطفأة، وتخصيص الإعلانات مُطفأ، ووضع الموافقة يرفض افتراضياً كل
 * تخزين إشهاري. وما عدا ذلك (Meta) وراء شريط الموافقة.
 */
export function GoogleAnalytics() {
  // الإنتاج وحده. في المعاينة لا يُحمَّل السكريبت ولا يُرسَل أي حدث، فلا
  // تختلط حركة الاختبار بأرقام الموقع الحقيقي. راجع isAnalyticsEnabled.
  if (!isAnalyticsEnabled()) return null;

  return (
    <>
      <Script
        id="ga4-gtag-src"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-gtag-init" strategy="afterInteractive">
        {`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'granted'
});
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}', {
  allow_google_signals: false,
  allow_ad_personalization_signals: false
});
        `}
      </Script>
    </>
  );
}
