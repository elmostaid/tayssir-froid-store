// رابط احتياطي ثابت يُستعمَل فقط عندما يكون SITE_URL مضبوطاً فعلياً (غير
// فارغ) لكن بقيمة غير صالحة كرابط — وليس عند غيابه تماماً (تلك حالة أخرى،
// تبقى null كما كانت). هذا ليس اختراعاً لدومين: الموقع الحقيقي فعلاً على
// هذا الدومين، وهو نفسه ما يُفترَض أن يكون مضبوطاً فـSITE_URL أصلاً.
const FALLBACK_SITE_URL = "https://www.tayssirfroid.com";

// عنوان الموقع النهائي (Production) الحقيقي. يُقرأ من متغيّر بيئة SITE_URL
// الذي يجب ضبطه يدوياً بعد ربط الدومين النهائي. طالما لم يُضبط إطلاقاً،
// ترجع هذه الدالة null وتتصرف كل الاستعمالات (sitemap، canonical،
// structured data) بحذر: بلا روابط مطلَقة مخترَعة.
//
// إذا كان SITE_URL مضبوطاً بقيمة **غير صالحة** كرابط (مثلاً بلا http(s)://،
// أو قيمة مصدرها خطأ فمصدر بيئة آخر خارج هذا المستودع بالكامل — الحالة
// الحقيقية التي كشفت هذا العطل) — new URL() فـlayout.tsx كانت سترمي
// استثناءً وقت تحميل الوحدة الجذرية المشتركة لكل صفحة، فيُسقِط next build
// بأكمله. بدل ذلك الآن: نتحقق من الصلاحية هنا مركزياً (المصدر الوحيد الذي
// يستدعيه new URL(siteUrl) وكل بقية الاستعمالات)، ونُرجع رابطاً احتياطياً
// ثابتاً معروفاً بدل الفشل الكامل، مع تسجيل خطأ واضح فالسجلات ليبقى العطل
// مرئياً وقابلاً للتشخيص لاحقاً، دون أن يوقف الموقع بأكمله.
export function getSiteUrl(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;

  const trimmed = raw.replace(/\/$/, "");
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    console.error(
      `getSiteUrl: قيمة SITE_URL غير صالحة كرابط ("${raw}") — استُعمل الرابط الاحتياطي الثابت (${FALLBACK_SITE_URL}) بدلاً منها بدل إسقاط البناء بالكامل.`
    );
    return FALLBACK_SITE_URL;
  }
}

// true فقط في نشر Vercel Production الحقيقي (وليس Preview أو التطوير
// المحلي) — يُستعمل لتحديد noindex في robots.ts.
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}
