import Script from "next/script";
import { GA_MEASUREMENT_ID } from "@/lib/analytics/config";

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
export function GoogleAnalytics() {
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
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');
        `}
      </Script>
    </>
  );
}
