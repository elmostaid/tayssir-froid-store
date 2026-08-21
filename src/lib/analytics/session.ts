import type {
  AnalyticsDeviceType,
  AnalyticsSessionContext,
} from "@/lib/analytics/events";

/**
 * الجلسة المجهولة: توليدها، حفظها، وقراءتها من كوكي أولى الطرف.
 *
 * لماذا كوكي وليس sessionStorage: الشراء يُسجَّل بعد أن يضغط الزبون "إرسال
 * الطلب"، وقد يكون فتح الموقع في تبويب ثانٍ أو رجع إليه من واتساب. الكوكي
 * وحدها تُبقي نفس الجلسة عبر التبويبات، وهي المكان الطبيعي لمهلة الخمول.
 *
 * لا شيء هنا يُخزَّن أو يُرسَل يمكن أن يُعرِّف شخصاً: مُعرّف عشوائي، ومسار
 * الصفحة، ووسوم الحملة التي كتبتَها أنت في رابط الإعلان.
 */

export const SESSION_COOKIE = "tf_sid";
export const CONTEXT_COOKIE = "tf_ctx";

/** مهلة الخمول: 30 دقيقة بلا أي حدث تُنهي الجلسة وتبدأ واحدة جديدة. */
export const SESSION_IDLE_MINUTES = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName.trim() === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_IDLE_MINUTES * 60}` +
    `; SameSite=Lax${secure}`;
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // متصفحات قديمة بلا crypto.randomUUID (وهي جزء حقيقي من جمهور الموقع):
  // مُعرّف عشوائي بنفس شكل UUID v4 حتى يقبله عمود uuid في القاعدة.
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[((Math.random() * 4) | 0) + 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host || null;
  } catch {
    return null;
  }
}

/**
 * التقاط سياق الجلسة من الصفحة الحالية. يقع مرة واحدة فقط، عند أول صفحة —
 * فلو دخل الزائر من إعلان ثم تنقّل بين خمس صفحات، تبقى الحملة منسوبة إلى
 * الإعلان لا إلى آخر صفحة زارها.
 */
export function captureSessionContext(): AnalyticsSessionContext {
  const params =
    typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const referrer = typeof document !== "undefined" ? document.referrer : "";
  const selfHost = typeof location !== "undefined" ? location.hostname : "";
  const referrerHost = referrer ? hostOf(referrer) : null;

  const get = (key: string) => {
    const value = params.get(key)?.trim();
    return value ? value : null;
  };

  return {
    landingPath: typeof location !== "undefined" ? location.pathname : "/",
    // تجاهل الإحالة الداخلية: تنقّل داخل الموقع ليس مصدر زيارة.
    referrerHost: referrerHost && referrerHost !== selfHost ? referrerHost : null,
    utmSource: get("utm_source"),
    utmMedium: get("utm_medium"),
    utmCampaign: get("utm_campaign"),
    utmContent: get("utm_content"),
    utmTerm: get("utm_term"),
    hasClickId: params.has("fbclid") || params.has("gclid") || params.has("ttclid"),
    startedAt: Date.now(),
  };
}

function parseContext(raw: string | null): AnalyticsSessionContext | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AnalyticsSessionContext>;
    if (typeof parsed.landingPath !== "string" || typeof parsed.startedAt !== "number") return null;
    return {
      landingPath: parsed.landingPath,
      referrerHost: parsed.referrerHost ?? null,
      utmSource: parsed.utmSource ?? null,
      utmMedium: parsed.utmMedium ?? null,
      utmCampaign: parsed.utmCampaign ?? null,
      utmContent: parsed.utmContent ?? null,
      utmTerm: parsed.utmTerm ?? null,
      hasClickId: Boolean(parsed.hasClickId),
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

export type AnalyticsSession = {
  sessionId: string;
  context: AnalyticsSessionContext;
  /** جلسة جديدة فعلاً (وليست استئنافاً لجلسة قائمة) — تُطلق session_start. */
  isNew: boolean;
};

/**
 * يُرجع الجلسة الحالية أو ينشئ واحدة. يُجدِّد مهلة الكوكيتين في كل استدعاء،
 * فتصبح المهلة "30 دقيقة خمول" لا "30 دقيقة من أول زيارة".
 */
export function getOrCreateSession(): AnalyticsSession | null {
  if (typeof document === "undefined") return null;

  const existingId = readCookie(SESSION_COOKIE);
  const existingContext = parseContext(readCookie(CONTEXT_COOKIE));

  if (existingId && UUID_RE.test(existingId) && existingContext) {
    writeCookie(SESSION_COOKIE, existingId);
    writeCookie(CONTEXT_COOKIE, JSON.stringify(existingContext));
    return { sessionId: existingId, context: existingContext, isNew: false };
  }

  const sessionId = newSessionId();
  const context = captureSessionContext();
  writeCookie(SESSION_COOKIE, sessionId);
  writeCookie(CONTEXT_COOKIE, JSON.stringify(context));
  return { sessionId, context, isNew: true };
}

export function detectDeviceType(userAgent: string, viewportWidth: number): AnalyticsDeviceType {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return "mobile";
  // بعض متصفحات "وضع سطح المكتب" على الهواتف تُخفي كل الإشارات أعلاه — عرض
  // الشاشة يبقى الدليل الأخير.
  return viewportWidth > 0 && viewportWidth < 768 ? "mobile" : "desktop";
}

/**
 * المتصفح، بتفصيل يهمّنا تجارياً: متصفح فيسبوك وإنستغرام الداخليان مفصولان
 * صراحةً لأن معظم زوّار الحملة يصلون من داخلهما، وسلوكهما يستحق قراءة
 * منفصلة عن Chrome العادي.
 */
export function detectBrowser(userAgent: string): string {
  const ua = userAgent;
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "fb_inapp";
  if (/Instagram/i.test(ua)) return "ig_inapp";
  if (/EdgA?\//i.test(ua)) return "edge";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/OPR\/|Opera/i.test(ua)) return "opera";
  if (/Firefox\//i.test(ua)) return "firefox";
  if (/Chrome\//i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua)) return "safari";
  return "other";
}
