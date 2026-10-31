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
  return process.env.META_OFFLINE_PURCHASES_ENABLED?.trim() === "true";
}
