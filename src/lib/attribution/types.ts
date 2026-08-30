/**
 * التعريفات المشتركة بين المتصفح والخادم لنسب الطلب إلى مصدره.
 *
 * لا شيء هنا يستورد React ولا قاعدة البيانات — ملف واحد يقرأه الطرفان، حتى
 * لا تنحرف صيغة ما يُرسَل عمّا يُخزَّن.
 */

/** لمسة واحدة: دخول الزائر إلى الموقع من مصدر معروف. */
export type AttributionTouch = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  /** مُعرّفات النقر الإعلانية — تُخزَّن مع الطلب وحده، انظر الملاحظة أسفله. */
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  landingPath: string | null;
  referrerHost: string | null;
  /** لحظة اللمسة (ms منذ epoch). */
  at: number;
};

/**
 * ما يُخزَّن مع الطلب: أول لمسة وآخر لمسة.
 *
 * first: كيف عرف الزبون الموقع أول مرة (يبقى ثابتاً ولا يُكتب فوقه أبداً).
 * last: آخر مصدر أدخله قبل الطلب (هو المعتمَد في نسب التحويل عادةً).
 */
export type OrderAttribution = {
  first: AttributionTouch | null;
  last: AttributionTouch | null;
};

/** حد أعلى لطول أي قيمة — يُقصّ بصمت بدل رفض الطلب. */
export const MAX_ATTRIBUTION_VALUE_LENGTH = 512;

const TOUCH_KEYS = [
  "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm",
  "fbclid", "gclid", "ttclid", "landingPath", "referrerHost",
] as const;

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, MAX_ATTRIBUTION_VALUE_LENGTH);
}

/**
 * تنقية لمسة قادمة من المتصفح. تُستعمَل من الخادم قبل التخزين: المتصفح ليس
 * مصدراً موثوقاً، فأي حقل غير معروف يُسقَط وأي نص طويل يُقصّ.
 */
export function sanitizeTouch(raw: unknown): AttributionTouch | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;

  const touch: AttributionTouch = {
    utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
    fbclid: null, gclid: null, ttclid: null, landingPath: null, referrerHost: null,
    at: typeof input.at === "number" && Number.isFinite(input.at) ? input.at : Date.now(),
  };
  for (const key of TOUCH_KEYS) touch[key] = trimmed(input[key]);

  // لمسة بلا أي معلومة مصدر لا تستحق التخزين.
  const hasAnything = TOUCH_KEYS.some((key) => touch[key] !== null);
  return hasAnything ? touch : null;
}

/** تنقية الحمولة كاملة. تُرجع null إن لم يبق شيء يستحق التخزين. */
export function sanitizeAttribution(raw: unknown): OrderAttribution | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const first = sanitizeTouch(input.first);
  const last = sanitizeTouch(input.last);
  if (!first && !last) return null;
  return { first, last };
}

/** وصف مقروء لمصدر اللمسة — يُستعمَل في لوحة الإدارة. */
export function describeTouch(touch: AttributionTouch | null): string {
  if (!touch) return "غير معروف";
  if (touch.utmSource) {
    const parts = [touch.utmSource];
    if (touch.utmMedium) parts.push(touch.utmMedium);
    return parts.join(" / ");
  }
  if (touch.fbclid) return "facebook (fbclid)";
  if (touch.gclid) return "google (gclid)";
  if (touch.ttclid) return "tiktok (ttclid)";
  if (touch.referrerHost) return touch.referrerHost;
  return "مباشر";
}
