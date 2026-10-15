/**
 * مفتاح تفرّد الطلبية اليدوية — وأين يعيش بالضبط.
 *
 * ## العطل الذي يُغلقه
 *
 * `createManualOrder` كان يكتب داخل `sql.begin` **بلا أي مفتاح تفرّد**،
 * بخلاف `createOrder.ts` (مسار الموقع) الذي يحرس إدخاله بـ`on conflict
 * (idempotency_key) do nothing` منذ البداية. فإن نجح `COMMIT` على الخادم
 * ثم انقطع الاتصال قبل أن يصل الإقرار، يرى المدير خطأً ويُعيد المحاولة —
 * فتُنشأ **طلبية ثانية ويُخصم المخزون مرتين**.
 *
 * وهذا ليس افتراضاً: قيس على قاعدة معزولة. نداءان متطابقان أنتجا
 * `TF-2026-0149` و`TF-2026-0150`، والمخزون نزل من 100 إلى 96 لا إلى 98.
 *
 * ## لماذا المتصفّح هو من يُولّد المفتاح
 *
 * لأن الخادم لا يستطيع. مفتاح يُولَّد في الخادم يكون **جديداً في كل
 * محاولة**، فلا يمنع شيئاً — وهو بالضبط ما يجعل التفرّد مسؤولية العميل في
 * كل واجهة تدفع عبرها الأموال. المفتاح يُولَّد **قبل أول محاولة حفظ**
 * ويبقى ثابتاً حتى تُعرَف النتيجة.
 *
 * ## ولماذا `sessionStorage` لا `useRef`
 *
 * `useRef` يموت مع إعادة تحميل الصفحة. والحالة التي نحمي منها هي بالضبط
 * «لا أعرف هل حُفظ»: المدير يرى خطأً أو شاشة معلّقة، فيضغط F5 — وهو أول
 * ما يفعله أي إنسان. لو وُلِّد مفتاح جديد عند التحميل الثاني لانتهينا إلى
 * طلبيتين. `sessionStorage` يحفظه داخل التبويب عبر إعادة التحميل، ولا
 * يتسرّب إلى تبويب آخر (حيث قد يُسجّل المدير طلبية مختلفة فعلاً).
 *
 * ولا `localStorage`: ذاك يبقى بعد إغلاق المتصفّح، فطلبية الغد قد تُدمَج
 * في طلبية اليوم.
 *
 * ## والمفتاح ليس سرّاً
 *
 * UUID عشوائي يُولّده المتصفّح ويُرسله في حقل مخفي. لا يمنح صلاحية ولا
 * يكشف بياناً — الصلاحية كلها في `requireOwner()` داخل الإجراء.
 */

/** مفتاح التخزين داخل `sessionStorage`. */
export const MANUAL_ORDER_KEY_STORAGE = "tf.manualOrder.idempotencyKey";

/** اسم الحقل المخفي في النموذج. */
export const MANUAL_ORDER_KEY_FIELD = "idempotencyKey";

/**
 * المفتاح يُوسَم بمصدره حتى لا تختلط طلبية يدوية بتحويل Lead: التحويل له
 * حارسه الذرّي الخاص (`convertWhatsappLead.ts`)، ومفتاحٌ مشترك بينهما كان
 * سيجعل تحويل Lead يُعيد طلبية يدوية سابقة.
 */
export function manualOrderStorageKey(leadId?: number): string {
  return leadId ? `${MANUAL_ORDER_KEY_STORAGE}.lead.${leadId}` : MANUAL_ORDER_KEY_STORAGE;
}

/** صيغة مقبولة: UUID أو 16–128 حرفاً من [A-Za-z0-9_-]. */
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

/**
 * مفتاح جديد. `crypto.randomUUID` متاح في كل متصفّح يدعمه هذا المشروع
 * وفي Node 19+، والتراجع موجود لبيئة اختبار بلا `crypto` عالمي فقط.
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // تراجع لا يُستعمل في المتصفّح — عشوائية كافية لمفتاح تفرّد محلي.
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}${Math.random()
    .toString(36)
    .slice(2, 14)}`;
}
