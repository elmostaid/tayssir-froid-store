// عنوان الموقع النهائي (Production) الحقيقي — لا نخترعه أبداً. يُقرأ فقط من
// متغيّر بيئة SITE_URL الذي يجب ضبطه يدوياً بعد ربط الدومين النهائي. طالما
// لم يُضبط، ترجع هذه الدالة null وتتصرف كل الاستعمالات (sitemap، canonical،
// structured data) بحذر: بلا روابط مطلَقة مخترَعة.
//
// يتحقق أيضاً أن القيمة رابط https صالح فعلاً قبل إرجاعها. src/app/layout.tsx
// (الجذر، يُحمَّل مع كل صفحة فالموقع بلا استثناء) يمرّر هذه القيمة مباشرة
// إلى `new URL(...)` عند بناء metadataBase — قيمة SITE_URL غير صالحة (مثلاً
// مقتطف من DATABASE_URL أُلصق بالخطأ فالمتغيّر الخطأ) كانت تُسقط بناء الموقع
// بأكمله (كل صفحة، وليس فقط الصفحة التي ظهر فيها الخطأ فالسجلّ) بـ
// "TypeError: Invalid URL". الآن تُعامَل نفس معاملة عدم الضبط أصلاً: null
// آمن، بلا أي انهيار.
export function getSiteUrl(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  const normalized = raw.replace(/\/$/, "");
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalized;
  } catch {
    return null;
  }
}

// true فقط في نشر Vercel Production الحقيقي (وليس Preview أو التطوير
// المحلي) — يُستعمل لتحديد noindex في robots.ts.
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}
