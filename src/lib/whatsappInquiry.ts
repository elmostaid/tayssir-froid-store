/**
 * مرجع استفسار واتساب (Q-XXXXXXXXXX) — مشترك بين المتصفح والخادم.
 *
 * ## لماذا يوجد
 *
 * زرّ «استفسار» وأيقونة واتساب في بطاقة المنتج كانا يفتحان محادثة برسالة
 * عامة لا تحمل شيئاً: لا مرجع، ولا أثر للزيارة. فالبيعة التي تُغلق في تلك
 * المحادثة — والإعلان هو المصدر الرئيسي للمبيعات — لا يمكن ربطها بالإعلان
 * الذي جاء بالزائر. المرجع يسافر داخل نص الرسالة نفسه، فيقرؤه المدير في
 * المحادثة ويلصقه في الطلبية.
 *
 * ## لماذا يُشتقّ من مفتاح لا يُولَّد على الخادم
 *
 * نفس قرار سلة واتساب (W-): لا شيء يجوز أن يؤخّر فتح واتساب. المتصفح يولّد
 * المفتاح، والطرفان يشتقّان منه نفس المرجع بالدالة نفسها، والتسجيل يُرسَل
 * بـkeepalive دون انتظار.
 */

export const INQUIRY_KINDS = ["general", "product"] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INQUIRY_REFERENCE_PATTERN = /^Q-[0-9A-F]{10}$/;

export function isInquiryKey(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isInquiryKind(value: unknown): value is InquiryKind {
  return typeof value === "string" && (INQUIRY_KINDS as readonly string[]).includes(value);
}

/** `null` لمفتاح غير صالح — لا مرجع تقريبي يُربط بزيارة لم تقع. */
export function inquiryReferenceFromKey(key: string): string | null {
  if (!isInquiryKey(key)) return null;
  return `Q-${key.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

/** السطر الذي يُلحَق برسالة واتساب — نفسه في كل الأزرار. */
export function withInquiryReference(message: string, reference: string): string {
  return `${message}\n\nمرجع الاستفسار: ${reference}`;
}

/**
 * يستخرج مرجعاً من أي نص يلصقه المدير: المرجع وحده، أو الرسالة كاملة، أو
 * بحروف صغيرة. W- (سلة واتساب) بثماني خانات، وQ- (استفسار) بعشر — بالضبط.
 */
export function parseOriginReference(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.toUpperCase().match(/\b(Q-[0-9A-F]{10}|W-[0-9A-F]{8})\b/);
  return match ? match[1] : null;
}
