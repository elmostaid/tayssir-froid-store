import type { OrderSource } from "@/lib/orders/orderSource";

/**
 * القناة التي أُغلقت فيها البيعة ⇒ `action_source` كما تعرّفه Meta.
 *
 * ## القاعدة: القناة لا المصدر الإعلاني
 *
 * طلبية بدأت من إعلان على الموقع ثم أُغلقت في محادثة واتساب **بيعةُ
 * محادثة** (`chat`)، لا بيعة موقع. الإعلان الذي جاء بها يصل Meta عبر
 * `fbc` المُثبَت، لا بتزوير القناة. وتعريفات Meta حرفياً:
 * `chat` — «via a messaging app, SMS, or online messaging feature»،
 * `phone_call` — «over the phone»، `physical_store` — «in person at your
 * physical store».
 *
 * ## لماذا ليس `business_messaging`
 *
 * تلك القيمة لإعلانات Click-to-WhatsApp تحديداً، وتشترط WhatsApp Business
 * Platform (Cloud API) و`ctwa_clid` من webhook الرسائل ومعرّف حساب
 * WhatsApp Business. لا شيء من ذلك موجود: إعلاناتنا إعلانات موقع، والرقم
 * يعمل بتطبيق واتساب العادي. فإرسالها كان سيكون ادّعاءً بمعرّفات لا نملكها.
 */
export type MetaActionSource = "website" | "chat" | "phone_call" | "physical_store" | "other";

const BY_ORDER_SOURCE: Record<OrderSource, MetaActionSource> = {
  website: "website",
  whatsapp: "chat",
  phone: "phone_call",
  store: "physical_store",
  other: "other",
};

/** قيمة قديمة أو غير معروفة في `orders.source` ⇒ `null`: لا نخمّن قناة. */
export function actionSourceForOrderSource(source: string | null | undefined): MetaActionSource | null {
  if (!source) return null;
  return (BY_ORDER_SOURCE as Record<string, MetaActionSource>)[source] ?? null;
}

/**
 * مبيعات خارج الموقع إلى Meta: **مُطفأة افتراضياً**.
 *
 * إرسالها يربط ملف الطلبيات (هاتف الزبون) ببيانات منصّة إشهار خارج
 * المغرب — وهو «ربط» (interconnexion) و«نقل إلى الخارج» يشترطان إذناً
 * مسبقاً من CNDP (المادتان 12 و20 من القانون 09-08، والفقرتان 9 و10 من
 * المداولة D-939-2025). الكود جاهز؛ القرار ليس قراراً تقنياً.
 */
export function isOfflinePurchaseSharingEnabled(): boolean {
  return offlinePurchaseSharingSince() !== null;
}

/**
 * لحظة بدء المشاركة: مبيعات خارج الموقع المؤكَّدة **قبلها** لا تُرسَل أبداً.
 *
 * بدونها، تشغيل المفتاح كان سيُرسل كل بيعة يدوية قديمة عند أول تغيير حالة
 * لاحق لها (شحن، تسليم) — إرسالٌ بأثر رجعي لم يقرّره أحد. فالمفتاح وحده لا
 * يكفي: `META_OFFLINE_PURCHASES_SINCE` (ISO) شرطٌ معه، وغيابها أو فسادها ⇒
 * مُطفأ.
 */
export function offlinePurchaseSharingSince(): Date | null {
  if (process.env.META_OFFLINE_PURCHASES_ENABLED?.trim() !== "true") return null;
  const raw = process.env.META_OFFLINE_PURCHASES_SINCE?.trim();
  if (!raw) return null;
  const since = new Date(raw);
  return Number.isFinite(since.getTime()) ? since : null;
}

/**
 * Meta ترفض حدثاً أقدم من سبعة أيام، ونحن لا نحاول: بيعةٌ تأكّدت قبل ذلك
 * (زرّ إعادة على طلب قديم، أو تغيير حالة متأخّر) لا تُرسَل.
 */
export const MAX_PURCHASE_AGE_MS = 7 * 86_400_000;

/**
 * إرسال البيعة المؤكَّدة بلا موافقة كوكيز — على أساس **المصلحة المشروعة**
 * (المادة 4 من القانون 09-08)، بشروط تجعلها متناسبة:
 * - من الخادم وحده، بعد التأكيد: لا كوكي ولا Pixel ولا شيء في المتصفح.
 * - بيانات دنيا: القيمة، المنتجات، الهاتف مُجزَّأً، البلد. لا IP ولا متصفح
 *   ولا fbp/fbc ولا معرّف نقرة.
 * - الزبون مُخبَر قبل الطلب (صفحة الإتمام + /privacy) وله أن يعترض
 *   (`ad_consent = 'denied'` يمنع الإرسال).
 * - لا أثر رجعي: فقط الطلبيات المُنشأة بعد هذه اللحظة (بعد نشر الإخبار).
 *
 * مضبوط بـ`META_PURCHASE_LEGITIMATE_INTEREST_SINCE` (ISO). غيابه = القاعدة
 * القديمة: موافقة صريحة شرطٌ.
 */
export function legitimateInterestPurchasesSince(): Date | null {
  const raw = process.env.META_PURCHASE_LEGITIMATE_INTEREST_SINCE?.trim();
  if (!raw) return null;
  const since = new Date(raw);
  return Number.isFinite(since.getTime()) ? since : null;
}
