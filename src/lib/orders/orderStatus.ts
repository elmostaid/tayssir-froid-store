// قائمة حالات الطلب وحدها، بدون أي استيراد لـ@/lib/db (postgres) — حتى يمكن
// استيرادها بأمان من مكوّنات عميل ("use client") مثل نماذج تغيير الحالة.
export const ORDER_STATUSES = [
  "new",
  // فيه سطر لم يُحجز مخزونه: الطلب محفوظ كاملاً وينتظر مراجعة الموظّف.
  "needs_review",
  // راسلناه في واتساب وننتظر جوابه. اختيارية عمداً: من يؤكّد في أول رسالة
  // ينتقل new → confirmed مباشرة. فائدتها أنها تفصل "لم نراسله بعد" عن
  // "راسلناه ولم يجب"، وبلا هذا الفصل لا تُقاس نسبة الإغلاق أصلاً.
  "contacted",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// حالتان فقط يُرجعان المخزون المحجوز تلقائياً عند تفعيلهما (نفس الدالة
// المعمَّمة في actions.ts) — يُستعمل هنا وهناك حتى يبقى مصدر القرار واحداً.
export const RESTOCKING_STATUSES: readonly OrderStatus[] = ["cancelled", "returned"];

// مصدر وحيد لتسميات الحالة بالعربية — يُستعمل في كل مكان (قائمة الطلبات،
// صفحة تفاصيل الطلب، نموذج تغيير الحالة، سجل الحالات) بدل تكرار نفس
// القاموس في عدة ملفات (كان يسبب تعارضاً عند إضافة/حذف حالة).
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "جديد",
  needs_review: "يحتاج مراجعة",
  contacted: "تم التواصل",
  confirmed: "تم التأكيد",
  preparing: "قيد التجهيز",
  shipped: "تم الإرسال",
  delivered: "تم التسليم",
  cancelled: "ملغى",
  returned: "راجع",
};

export const ORDER_STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
  new: "bg-brand-orange/10 text-brand-orange-dark",
  needs_review: "bg-red-100 text-red-700",
  contacted: "bg-sky-100 text-sky-700",
  confirmed: "bg-brand-turquoise-tint text-brand-turquoise-dark",
  preparing: "bg-amber-100 text-amber-700",
  shipped: "bg-indigo-100 text-indigo-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  returned: "bg-purple-100 text-purple-700",
};

/**
 * الحالة التي تولد فيها البيعة تجارياً — وعندها وحدها يُرسَل `Purchase`.
 *
 * ليست `confirmed` وحدها: 13 طلباً في الإنتاج (13.7% من المشحونة) وصلت
 * `shipped` دون أن تمرّ بـ`confirmed` قطّ، لأن المدير يقفز الخطوة أحياناً.
 * ولو ربطنا الشراء بـ`confirmed` حرفياً لاختفت بيعة واحدة من كل سبع بسبب
 * اختصارٍ في الواجهة لا علاقة له بالزبون. فأيّ وصول إلى واحدة من هذه
 * الحالات اعترافٌ بأن البيعة تمّت.
 *
 * `delivered` داخلة كذلك: من يُسلّم طلباً باع قطعاً.
 */
export const SALE_CONFIRMED_STATUSES: readonly OrderStatus[] = [
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
];

/**
 * أسباب الإلغاء — قائمة مغلقة تطابق قيد القاعدة
 * (`orders_cancellation_reason_values`).
 *
 * سبب حرّ لا يُجمَع ولا يُقارَن، والهدف أن يُجيب العمود "لماذا نخسر
 * الطلبات" بأرقام. `unreachable` و`price_rejected` مفصولان عن
 * `not_confirmed` لأنهما قصّتان مختلفتان: "لا أحد يجيب" مشكلة جودة جمهور
 * (شأن الإعلان)، و"رأى الثمن ورفض" مشكلة عرض (شأن المتجر).
 */
export const CANCELLATION_REASONS = [
  "not_confirmed",
  "unreachable",
  "customer_cancelled",
  "price_rejected",
  "invalid_order",
  "duplicate",
  "out_of_stock",
  "other",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  not_confirmed: "لم يؤكّد في واتساب",
  unreachable: "لا يجيب على الهاتف",
  customer_cancelled: "الزبون تراجع بعد التأكيد",
  price_rejected: "رفض الثمن النهائي",
  invalid_order: "بيانات غير صالحة أو خارج التغطية",
  duplicate: "طلب مكرَّر",
  out_of_stock: "غير متوفّر في المخزون",
  other: "سبب آخر",
};

/** `other` وحده يُلزَم بملاحظة — بلا شرح لا يُجيب شيئاً. */
export const CANCELLATION_REASON_REQUIRING_NOTE: CancellationReason = "other";
