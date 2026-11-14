/**
 * معرّف القياس (Measurement ID) الخاص بـGoogle Analytics 4 لموقع Tayssir
 * Froid — كما تعطيه Google في «وسم Google» الرسمي للموقع.
 *
 * ثابت مكتوب هنا عمداً، لا متغيّر بيئة (على عكس NEXT_PUBLIC_META_PIXEL_ID):
 * هذا المعرّف ليس سرّاً إطلاقاً — يظهر كما هو داخل HTML لكل زائر، وهذا
 * تصميم Google نفسه — وهو قيمة واحدة ثابتة للموقع كله لا تختلف بين بيئة
 * وأخرى. تثبيته هنا يضمن أن الوسم يعمل فور النشر بلا أي إعداد يدوي إضافي
 * على Vercel. لا تضع هنا أبداً أي قيمة سرّية (رموز API، مفاتيح خادم).
 */
export const GA_MEASUREMENT_ID = "G-SEJZVX93W4";

/**
 * هل يُحمَّل وسم GA4 إطلاقاً في هذه البيئة؟
 *
 * السبب في وجود هذا الحارس: معرّف القياس أعلاه **ثابت في الكود** لا متغيّر
 * بيئة. فلا يوجد ما يمنع نشر معاينة من إرسال زياراته واختباراته إلى نفس
 * خاصية GA4 التي تُقاس بها مبيعات الموقع الحقيقي — فتُلوَّث أرقام القرار
 * التجاري بحركة ليست حركة زبناء.
 *
 * وبخلاف Meta Pixel وCAPI، اللذين يُطفئان أنفسهما في المعاينة بحكم أن
 * متغيّراتهما (NEXT_PUBLIC_META_PIXEL_ID وMETA_CONVERSIONS_API_ACCESS_TOKEN)
 * مقصورة على بيئة الإنتاج في Vercel، فإن GA4 كان سيعمل في كل بيئة.
 *
 * فالقاعدة: الإنتاج وحده. `VERCEL_ENV` تضبطها المنصّة بنفسها (production /
 * preview / development) ولا تُكتَب يدوياً. وفي غياب Vercel كلياً (تشغيل
 * ذاتي أو محلي) نكتفي بـNODE_ENV=production.
 */
export function isAnalyticsEnabled(
  env: { VERCEL_ENV?: string; NODE_ENV?: string } = process.env
): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}
