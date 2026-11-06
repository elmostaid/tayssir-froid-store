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

/**
 * وسم ديناميكي لم تعوّضه Meta (مثل `{{ad.id}}`). يحدث في بعض المواضع:
 * القيمة حرفياً هي القالب. تخزينه يوهم بمصدر معروف وهو ليس كذلك، فيُعامَل
 * كغياب للقيمة.
 */
export function isUnfilledMacro(value: string): boolean {
  return /^\{\{[^{}]*\}\}$/.test(value.trim());
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || isUnfilledMacro(text)) return null;
  return text.slice(0, MAX_ATTRIBUTION_VALUE_LENGTH);
}

/** المدة التي تُحمى فيها لمسة إعلانية من زيارة إحالة عارية من نفس الشبكة. */
export const PAID_TOUCH_PROTECTION_MS = 7 * 86_400_000;

const META_SOURCES = new Set(["facebook", "fb", "ig", "instagram", "meta", "messenger", "an", "audience_network"]);
const META_HOST = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|messenger\.com)$/i;

/** شبكة اللمسة: `meta` لفيسبوك/إنستغرام/ماسنجر، وإلا null. */
export function touchNetwork(touch: Pick<AttributionTouch, "utmSource" | "referrerHost" | "fbclid">): "meta" | null {
  const source = touch.utmSource?.trim().toLowerCase();
  if (source && META_SOURCES.has(source)) return "meta";
  if (touch.fbclid) return "meta";
  if (touch.referrerHost && META_HOST.test(touch.referrerHost)) return "meta";
  return null;
}

/** هل تحمل اللمسة وسوم حملة أو معرّف نقرة (أي نقرة على إعلان بعينه)؟ */
export function hasCampaignTags(touch: AttributionTouch): boolean {
  return Boolean(
    touch.utmSource || touch.utmMedium || touch.utmCampaign || touch.utmContent ||
      touch.utmTerm || touch.fbclid || touch.gclid || touch.ttclid
  );
}

/**
 * هل تبقى آخر لمسة محفوظة بدل اللمسة الجديدة؟
 *
 * نعم فقط حين تكون الجديدة إحالة عارية (بلا أي وسم) من **نفس الشبكة** التي
 * جاءت منها لمسة إعلانية موسومة قبل أقل من 7 أيام. مثال حقيقي (طلبية 363):
 * زبون نقر إعلان مكينات الصابون، ثم عاد في اليوم التالي من m.facebook.com
 * بلا وسوم إلى صفحة منتج — فمُحي رقم الإعلان من الطلبية. الإحالة العارية لا
 * تقول أي إعلان، فلا تُسقط معلومة أدقّ منها.
 *
 * ولا خلط بين إعلانين: أي نقرة على إعلان آخر تحمل وسومها، فتأخذ مكانها
 * دائماً (آخر نقرة). وإحالة من شبكة أخرى (جوجل مثلاً) تأخذ مكانها أيضاً.
 */
export function shouldKeepPreviousTouch(
  next: AttributionTouch,
  previous: AttributionTouch | null,
  now: number = Date.now()
): boolean {
  if (!previous) return false;
  if (hasCampaignTags(next)) return false;
  if (!hasCampaignTags(previous)) return false;
  if (now - previous.at > PAID_TOUCH_PROTECTION_MS) return false;
  const network = touchNetwork(next);
  return network !== null && network === touchNetwork(previous);
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
