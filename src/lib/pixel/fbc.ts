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
 * - `subdomainIndex`: عدد مقاطع النطاق فوق اللاحقة العامة. النطاق
 *   `tayssirfroid.com` ⇒ 1، و`www.tayssirfroid.com` ⇒ 2. يُشتقّ من المضيف
 *   الفعلي لا يُفترَض، لأن المشروع يُقدَّم من الاثنين.
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
 * عدد مقاطع النطاق فوق اللاحقة العامة.
 *
 * حساب بسيط مقصود: اللاحقة المعتبرة مقطع واحد (`.com`, `.ma`). المشروع
 * يُقدَّم من `tayssirfroid.com` وحده، فلا داعٍ لجدول اللواحق العامة كاملاً
 * من أجل حالة لا تقع. وعند الشك نرجع 1 — وهو الأصحّ لنطاق مُسجَّل.
 */
export function subdomainIndexFromHost(host: string | null | undefined): number {
  if (!host) return 1;
  // إسقاط المنفذ وأي مسار، وتطبيع الحالة.
  const clean = host.trim().toLowerCase().split("/")[0]?.split(":")[0] ?? "";
  if (!clean || clean === "localhost") return 1;
  // عنوان IP: لا مقاطع نطاق أصلاً.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return 1;
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return 1;
  return parts.length - 1;
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
