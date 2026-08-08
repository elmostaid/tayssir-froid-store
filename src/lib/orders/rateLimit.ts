// حماية بسيطة وأولية (best-effort) ضد إنشاء عدد كبير من الطلبات في وقت
// قصير من نفس رقم الهاتف. هذا حد في الذاكرة (in-memory) خاص بنفس نسخة
// الخادم فقط — في بيئة serverless متعددة النسخ (مثل Vercel) لا يضمن حداً
// صارماً عبر كل النسخ، لكنه يوقف أبسط أشكال إساءة الاستعمال (نقر متكرر أو
// سكربت بسيط) دون الحاجة إلى بنية تحتية إضافية (Redis وغيره) غير متوفرة
// حالياً في هذا المشروع.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

const attemptsByPhone = new Map<string, number[]>();

export function isRateLimited(normalizedPhone: string): boolean {
  const now = Date.now();
  const attempts = (attemptsByPhone.get(normalizedPhone) ?? []).filter(
    (timestamp) => now - timestamp < WINDOW_MS
  );

  if (attempts.length >= MAX_REQUESTS_PER_WINDOW) {
    attemptsByPhone.set(normalizedPhone, attempts);
    return true;
  }

  attempts.push(now);
  attemptsByPhone.set(normalizedPhone, attempts);
  return false;
}
