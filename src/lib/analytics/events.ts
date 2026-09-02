/**
 * التعريفات المشتركة بين المتصفح والخادم لنظام القياس الداخلي.
 *
 * لا شيء هنا يستورد React ولا قاعدة البيانات — ملف واحد يقرأه الطرفان، حتى
 * تبقى قائمة الأحداث وحدودها مصدراً واحداً للحقيقة بدل نسختين تنحرفان.
 */

export const ANALYTICS_ENDPOINT = "/api/analytics";

/**
 * الأحداث الثمانية، بنفس ترتيب مسار الزائر. القائمة مغلقة في ثلاثة مواضع
 * متطابقة عمداً: هنا، وفي التحقّق داخل /api/analytics، وفي قيد CHECK داخل
 * قاعدة البيانات — فحتى لو أُرسل اسم مخترع من متصفح معدَّل، لا يدخل الجدول.
 *
 * `whatsapp_from_cart` يقع **بدل** begin_checkout لا بعده: الزبون يغادر إلى
 * واتساب من السلة مباشرة بلا نموذج. فصله عن begin_checkout هو ما يسمح
 * بقراءة السؤال الحقيقي — هل أضاف المسار الجديد طلبات، أم سحب من مسار
 * قائم؟ ولا يمكن قياس ذلك إن اشتركا في اسم واحد.
 */
export const ANALYTICS_EVENT_NAMES = [
  "session_start",
  "landing_page_view",
  "product_view",
  "add_to_cart",
  "cart_view",
  "begin_checkout",
  "whatsapp_from_cart",
  "purchase",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

export type AnalyticsDeviceType = "mobile" | "tablet" | "desktop";

/** سياق الجلسة — يُلتقط مرة واحدة عند أول صفحة ويُعاد إرساله مع كل حدث. */
export type AnalyticsSessionContext = {
  landingPath: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  /**
   * وجود مُعرّف نقرة إعلانية (fbclid/gclid) فقط — القيمة نفسها لا تُرسَل ولا
   * تُخزَّن أبداً. تكفي للتفريق بين زيارة مدفوعة وعضوية بلا حمل أي مُعرّف
   * يمكن ربطه بشخص بعينه.
   */
  hasClickId: boolean;
  /** بداية الجلسة (ms منذ epoch) — لحساب session_ms من جهة المتصفح. */
  startedAt: number;
};

/** الحقول الخاصة بحدث بعينه. كلها اختيارية: session_start لا يحمل أياً منها. */
export type AnalyticsEventPayload = {
  productId?: number | null;
  sku?: string | null;
  quantity?: number | null;
  cartValue?: number | null;
  /**
   * المرجع العام للطلب (public_reference) — يُستعمَل من الخادم للبحث عن
   * order_id ثم يُرمى. لا يُخزَّن في جدول القياس.
   */
  orderRef?: string | null;
  orderValue?: number | null;
};

/** الحدث كما يُرسَل على السلك. */
export type AnalyticsWireEvent = AnalyticsEventPayload & {
  name: AnalyticsEventName;
  pagePath: string;
  sessionMs: number;
};

export type AnalyticsWireBatch = {
  sessionId: string;
  context: AnalyticsSessionContext;
  deviceType: AnalyticsDeviceType;
  browser: string;
  viewportW: number;
  viewportH: number;
  events: AnalyticsWireEvent[];
};

/**
 * حد أعلى لعدد الأحداث في الطلب الواحد. التجميع في المتصفح يجعل الرقم
 * العادي 2–6؛ الحد هنا يمنع طلباً واحداً مُصطنعاً من إدراج آلاف الصفوف.
 */
export const MAX_EVENTS_PER_BATCH = 20;

/** حد أعلى لطول أي نص مُرسَل — يُقصّ بصمت بدل رفض الدفعة كلها. */
export const MAX_TEXT_LENGTH = 512;
