// عنوان الموقع النهائي (Production) الحقيقي — لا نخترعه أبداً. يُقرأ فقط من
// متغيّر بيئة SITE_URL الذي يجب ضبطه يدوياً بعد ربط الدومين النهائي. طالما
// لم يُضبط، ترجع هذه الدالة null وتتصرف كل الاستعمالات (sitemap، canonical،
// structured data) بحذر: بلا روابط مطلَقة مخترَعة.
export function getSiteUrl(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

// true فقط في نشر Vercel Production الحقيقي (وليس Preview أو التطوير
// المحلي) — يُستعمل لتحديد noindex في robots.ts.
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}
