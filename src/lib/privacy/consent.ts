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

/**
 * هل يُجمَع اختيار الزائر أصلاً؟ **مطفأ في الإنتاج** (قرار صاحب المشروع،
 * 2026-11-01: لا شريط ولا نافذة). وبلا آلية موافقة لا أساس لكوكيز Meta:
 * كل كوكي `tf_ad_consent` قديمة تُقرأ `unknown`، فلا Pixel، ولا هوية
 * إعلانية، ولا Purchase إلى Meta. يُعاد تشغيله بـ
 * `NEXT_PUBLIC_AD_CONSENT_ENABLED=on` (وقت البناء) مع إعادة الشريط.
 */
export function isAdConsentCollectionEnabled(): boolean {
  // نمط الرفض المتاح يقرأ الاختيار دائماً: بدون ذلك لا يُحترَم رفضٌ صريح.
  return process.env.NEXT_PUBLIC_AD_CONSENT_ENABLED === "on" || isAdTrackingOptOut();
}

/**
 * نمط «الرفض متاح» (قرار صاحب المشروع، 2026-11-06): قياس Meta يعمل لكل
 * زائر **ما لم يرفض صراحةً** من «إعدادات الكوكيز» — كما كان قبل 2026-10-31،
 * بلا شريط. الرفض الصريح (`denied`) يبقى نافذاً في كل مسار.
 *
 * بلا هذا المتغير يبقى السلوك «بموافقة مسبقة فقط» كما هو.
 */
export function isAdTrackingOptOut(): boolean {
  return process.env.NEXT_PUBLIC_AD_TRACKING_OPT_OUT === "on";
}

/**
 * هل يُسمح بالقياس الإعلاني لهذا الاختيار؟ موافقة صريحة دائماً؛ و«لم يختر»
 * أيضاً في نمط الرفض المتاح. الرفض الصريح لا يُسمح له أبداً.
 *
 * هذه هي البوّابة الوحيدة لقرارات الإرسال (Pixel، CAPI، معرّفات النقر،
 * الهوية). القيمة المحفوظة مع الطلبية تبقى الاختيار الحقيقي، لا تفسيره.
 */
export function isAdTrackingAllowed(value: unknown): boolean {
  const consent = parseAdConsent(value);
  if (consent === "granted") return true;
  return consent === "unknown" && isAdTrackingOptOut();
}

/**
 * كيف يُسأل الزائر حين يكون الجمع مُفعَّلاً:
 *
 * - `settings` (الافتراضي): لا شيء يظهر من تلقاء نفسه. الزائر يفتح
 *   الاختيار بنفسه من رابط «إعدادات الكوكيز» أسفل الموقع أو صفحة الخصوصية.
 *   هذا ما يحترم قرار 2026-11-01 (لا شريط ولا نافذة)، وثمنه أن قلّة فقط
 *   ستوافق.
 * - `banner`: الشريط يظهر أسفل الصفحة لمن لم يختر بعد (الزرّان بنفس الوزن).
 *
 * أي قيمة أخرى ⇒ `settings`: الخطأ في الضبط لا يُظهر شريطاً لم يُطلب.
 */
export type AdConsentPromptMode = "banner" | "settings";

export function adConsentPromptMode(): AdConsentPromptMode {
  return process.env.NEXT_PUBLIC_AD_CONSENT_PROMPT === "banner" ? "banner" : "settings";
}

/** الاختيار كما تحمله كوكي الزائر — `unknown` دائماً ما دام الجمع مطفأً. */
export function adConsentFromCookie(raw: unknown): AdConsent {
  return isAdConsentCollectionEnabled() ? parseAdConsent(raw) : "unknown";
}

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
    return adConsentFromCookie(match ? decodeURIComponent(match.slice(AD_CONSENT_COOKIE.length + 1)) : null);
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
