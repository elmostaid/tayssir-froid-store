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

// استفسارات واتساب: لا هاتف بعد، فالمفتاح عنوان IP. السقف واسع عمداً (زائر
// يسأل عن عشرين قطعة في ربع ساعة سلوكٌ حقيقي)، ويوقف فقط سكربتاً يملأ
// الجدول. ونفس حدود الذاكرة أعلاه: best-effort لكل نسخة خادم.
const INQUIRY_WINDOW_MS = 15 * 60 * 1000;
const MAX_INQUIRIES_PER_WINDOW = 30;
const inquiriesByIp = new Map<string, number[]>();

export function isInquiryRateLimited(clientIp: string | undefined): boolean {
  if (!clientIp) return false;
  const now = Date.now();
  const recent = (inquiriesByIp.get(clientIp) ?? []).filter((t) => now - t < INQUIRY_WINDOW_MS);
  if (recent.length >= MAX_INQUIRIES_PER_WINDOW) {
    inquiriesByIp.set(clientIp, recent);
    return true;
  }
  recent.push(now);
  inquiriesByIp.set(clientIp, recent);
  return false;
}
