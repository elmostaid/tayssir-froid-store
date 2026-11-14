/**
 * بناء `fbc` من `fbclid` حين لا توجد كوكي `_fbc`.
 *
 * ## لماذا هذا الملف موجود
 *
 * `fbc` هو مفتاح الإسناد الوحيد الذي يربط حدثاً بنقرة إعلانية. وكان يُقرأ
 * من كوكي `_fbc` فقط — وهي كوكي **تكتبها Meta Pixel نفسها**، لا هذا
 * المشروع (لا سطر واحد في `src/` يكتبها). فإذا حُجبت الـPixel أو تأخّرت أو
 * فشلت، تصل أحداث Conversions API إلى Meta **بلا إسناد لأي إعلان**، فلا
 * تظهر في تقارير الحملة. أي أن CAPI لم يكن مساراً مستقلاً: مفتاحه يأتي من
 * الـPixel التي يُفترض أن يحميها.
 *
 * والمفارقة أن `fbclid` **محفوظ عندنا أصلاً**: `lib/attribution/capture.ts`
 * يقبطه من الرابط ويخزّنه مع لحظته (`at`) في `attribution_first/last`، ومن
 * ثمّ في `orders`. فكل ما يلزم لبناء `fbc` صحيح موجود؛ لم يكن موصولاً.
 *
 * ## الصيغة
 *
 *   fb.<subdomainIndex>.<creationTime>.<fbclid>
 *
 * - `subdomainIndex`: عدد مقاطع **النطاق الذي كُتبت عليه الكوكي**، لا مقاطع
 *   المضيف الذي وقع فيه الحدث. وMeta Pixel تكتب `_fbc` على النطاق المُسجَّل
 *   دائماً، فـ`tayssirfroid.com` و`www.tayssirfroid.com` كلاهما ⇒ **1**.
 *   (الدليل في `subdomainIndexFromHost` أدناه — قياسٌ من كوكي حقيقية.)
 * - `creationTime`: لحظة **أول** ظهور الـfbclid بالمللي ثانية — لا
 *   `Date.now()`. وقتٌ خاطئ هنا يعني نافذة إسناد خاطئة، وMeta تتعامل مع
 *   القيمة كما وصلت.
 * - `fbclid`: كما جاء في الرابط، بلا تعديل.
 */

/** الحد الأعلى لطول fbclid — أطول منه يعني قيمة تالفة لا نرسلها. */
const MAX_FBCLID_LENGTH = 512;

/** fbclid من Meta أبجدي-رقمي مع `-` و`_` (base64url). */
const FBCLID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * لواحق المستوى الثاني التي تحتاج ثلاثة مقاطع ليكتمل نطاقٌ مُسجَّل
 * (`co.uk`, `com.br`, `co.ma`). قائمة قصيرة مقصودة بدل جدول اللواحق
 * العامة كاملاً: المتجر على `.com`، وهذه تكفي لئلا يُحسَب `example.co.uk`
 * كأنّ `co.uk` نطاقٌ مُسجَّل.
 */
const SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

/**
 * فهرس النطاق الذي **تكتب Meta الكوكي عليه** — لا فهرس مضيف الصفحة.
 *
 * ## لماذا تغيّر هذا الحساب
 *
 * كان يُرجع 2 لـ`www.tayssirfroid.com` (عدد المقاطع ناقص واحد)، اتباعاً
 * لمثال Meta في التوثيق: `com`=0، `facebook.com`=1، `www.facebook.com`=2.
 * والمثال صحيح، لكنه يصف **النطاق الذي عُرِّفت عليه الكوكي**، لا الصفحة.
 *
 * والقياس حسم الفرق: كوكي `_fbc` الحقيقية في الطلب 176 (طلب موقع من
 * 2026-10-07 على `www.tayssirfroid.com`)، وقد كتبتها Meta Pixel بنفسها،
 * تبدأ بـ`fb.1.` — لأن الـPixel تضع الكوكي على النطاق المُسجَّل
 * (`tayssirfroid.com`) حتى حين تكون الصفحة على `www`.
 *
 * فلو بقينا نبني `fb.2.…` لكان كل `fbc` نبنيه من `fbclid` مخالفاً في صيغته
 * لكل `fbc` تكتبه Meta لنفس الموقع — وهو بالضبط المسار الذي أُنشئ هذا
 * الملف لإنقاذه حين تغيب الكوكي.
 */
export function subdomainIndexFromHost(host: string | null | undefined): number {
  if (!host) return 1;
  // يقبل مضيفاً أو رابطاً كاملاً: المُنادون يُمرّرون الاثنين —
  // `request.headers.get("host")` مضيفٌ مجرَّد، و`capi_identity.eventSourceUrl`
  // رابطٌ كامل. فنُقشّر البادئة أولاً، ثم المسار، ثم المنفذ.
  const withoutScheme = host.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const clean = withoutScheme.split("/")[0]?.split("@").pop()?.split(":")[0] ?? "";
  if (!clean || clean === "localhost") return 1;
  // عنوان IP: لا مقاطع نطاق أصلاً.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return 1;
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return 1;
  // النطاق المُسجَّل = مقطعان، أو ثلاثة تحت لاحقة مستوى ثانٍ. وأي نطاقات
  // فرعية فوقه لا تُحتسب: الكوكي ليست عليها.
  const registrableLabels = SECOND_LEVEL_SUFFIXES.has(parts[parts.length - 2]) ? 3 : 2;
  return registrableLabels - 1;
}

/**
 * يبني `fbc` صالحاً، أو `null` إن لم تكن المُدخلات صالحة.
 *
 * `null` لا قيمة تقريبية: حدث بلا `fbc` يُسنَد بوسائل أخرى (fbp، الهاتف
 * المُهشَّر)، أما `fbc` مُلفَّق فيكسر الإسناد ولا يُعلن عن نفسه.
 */
export function buildFbc(params: {
  fbclid: string | null | undefined;
  /** لحظة أول ظهور الـfbclid (ms منذ epoch) — `attributionTouch.at`. */
  fbclidAt: number | null | undefined;
  /** مضيف الصفحة التي وقع فيها الحدث، لاشتقاق subdomainIndex. */
  host?: string | null;
}): string | null {
  const fbclid = typeof params.fbclid === "string" ? params.fbclid.trim() : "";
  if (!fbclid || fbclid.length > MAX_FBCLID_LENGTH || !FBCLID_PATTERN.test(fbclid)) {
    return null;
  }

  const at = params.fbclidAt;
  // وقت غير صالح، أو من المستقبل، أو قبل وجود المتجر: لا نخترع لحظة.
  // 2020-01-01 حدٌّ أدنى معقول يرفض 0 وقيم الثواني (بدل المللي).
  const MIN_AT = 1_577_836_800_000;
  if (typeof at !== "number" || !Number.isFinite(at) || at < MIN_AT || at > Date.now() + 60_000) {
    return null;
  }

  return `fb.${subdomainIndexFromHost(params.host)}.${Math.floor(at)}.${fbclid}`;
}

/**
 * الكوكي أولاً، ثم البناء — بهذا الترتيب دائماً.
 *
 * كوكي `_fbc` كتبتها Meta نفسها، فهي المرجع حين توجد. البناء بديلٌ عند
 * غيابها، لا بديلٌ عنها.
 */
export function resolveFbc(params: {
  cookieFbc: string | null | undefined;
  fbclid: string | null | undefined;
  fbclidAt: number | null | undefined;
  host?: string | null;
}): string | null {
  const cookie = typeof params.cookieFbc === "string" ? params.cookieFbc.trim() : "";
  if (cookie) return cookie;
  return buildFbc({ fbclid: params.fbclid, fbclidAt: params.fbclidAt, host: params.host });
}
