/**
 * موافقة الزائر على قياس الإشهار — مصدر واحد يقرؤه المتصفح والخادم.
 *
 * ## لماذا موافقة مسبقة، لا إشعار فقط
 *
 * مداولة CNDP رقم D-939-2025 (28/11/2025، الفقرة 6): كوكيز «الإشهار
 * المخصَّص» تُستثنى صراحةً من الإعفاء، و«قبل أول إيداع للكوكيز» يجب جمع
 * موافقة «بفعل واضح وصريح» مع إمكانية الرفض. وMeta Pixel (`_fbp`، `_fbc`)
 * وConversions API موجودان بالضبط لهذا الغرض. فلا Pixel، ولا هوية متصفح
 * تُرسَل إلى Meta، قبل `granted`.
 *
 * ## لماذا ثلاث قيم لا اثنتان
 *
 * `unknown` ليست `denied`: الزائر لم يُجب بعد. لكنها تُعامَل مثلها في كل
 * قرار إرسال — الصمت ليس موافقة. الفرق يُحفظ فقط لأنه يُقرأ في التقارير:
 * «رفض» و«لم يُسأل» مشكلتان مختلفتان.
 *
 * ## المدة
 *
 * 180 يوماً: نفس المداولة تحدّ الاحتفاظ بالاختيار وبيانات الكوكيز بستة
 * أشهر. بعدها يُسأل الزائر من جديد.
 */

export const AD_CONSENT_COOKIE = "tf_ad_consent";

/** ستة أشهر — الحدّ الأقصى في مداولة CNDP D-939-2025. */
export const AD_CONSENT_MAX_AGE_DAYS = 180;

/** حدث النافذة الذي يُطلَق عند كل تغيير اختيار، لمن يحتاج أن يتفاعل فوراً. */
export const AD_CONSENT_EVENT = "tf:ad-consent";

export type AdConsent = "granted" | "denied" | "unknown";

/** أي قيمة غير معروفة (كوكي تالفة، قديمة، مزوّرة) ⇒ `unknown`، لا موافقة. */
export function parseAdConsent(raw: unknown): AdConsent {
  return raw === "granted" || raw === "denied" ? raw : "unknown";
}

export function isAdConsentGranted(value: unknown): boolean {
  return parseAdConsent(value) === "granted";
}

/** قراءة الاختيار من كوكيز المتصفح. خارج المتصفح ⇒ `unknown`. */
export function readAdConsentFromDocument(): AdConsent {
  if (typeof document === "undefined") return "unknown";
  try {
    const match = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${AD_CONSENT_COOKIE}=`));
    return parseAdConsent(match ? decodeURIComponent(match.slice(AD_CONSENT_COOKIE.length + 1)) : null);
  } catch {
    return "unknown";
  }
}

/**
 * حفظ الاختيار وإبلاغ الصفحة.
 *
 * كوكي لا localStorage: الخادم يحتاج أن يقرأها في كل طلب (`/api/orders`،
 * `/api/pixel-events`، الاستفسارات) ليقرّر هو أيضاً — لا يكفي أن يمتنع
 * المتصفح وحده.
 */
export function writeAdConsent(value: Exclude<AdConsent, "unknown">): void {
  if (typeof document === "undefined") return;
  try {
    const maxAge = AD_CONSENT_MAX_AGE_DAYS * 86_400;
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${AD_CONSENT_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
    window.dispatchEvent(new CustomEvent(AD_CONSENT_EVENT, { detail: value }));
  } catch {
    // كوكيز محظورة: يبقى `unknown`، أي لا قياس — الاتجاه الآمن.
  }
}

/** للاشتراك من React (`useSyncExternalStore`). */
export function subscribeAdConsent(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AD_CONSENT_EVENT, onChange);
  return () => window.removeEventListener(AD_CONSENT_EVENT, onChange);
}
