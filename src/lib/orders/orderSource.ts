/**
 * مصدر الطلب: من أين وصل فعلاً.
 *
 * العمود `orders.source` موجود منذ المخطّط الأول بقيمة افتراضية 'website'
 * وبلا قيد CHECK، فإضافة المصادر اليدوية لم تحتج أي تعديل في قاعدة
 * البيانات. والقائمة المغلقة تُفرَض هنا في الكود بدل قيد في القاعدة —
 * قصداً: تغيير قيد CHECK على جدول إنتاج حيّ ثمنٌ لا يستحقّه منع خطأ لا
 * يستطيع ارتكابه إلا من يكتب SQL يدوياً.
 *
 * لماذا التفريق أصلاً: مبيعات واتساب والهاتف مبيعات حقيقية تدخل الإيراد
 * والأرباح، لكنها **لم تمرّ بالموقع**. فلو دخلت قمع التحويل لأصبحت نسبة
 * "زائر ← طلب" تقيس شيئاً لم يقع على الموقع إطلاقاً.
 */

export const ORDER_SOURCES = ["website", "whatsapp", "phone", "store", "other"] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number];

/** المصادر التي يختارها المدير عند تسجيل طلب يدوي — الموقع ليس منها. */
export const MANUAL_ORDER_SOURCES = ORDER_SOURCES.filter(
  (source): source is Exclude<OrderSource, "website"> => source !== "website"
);

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  website: "الموقع",
  whatsapp: "واتساب",
  phone: "هاتف",
  store: "المحل",
  other: "آخر",
};

/** ألوان الوسم في القوائم — الموقع محايد، وما عداه برتقالي ليُميَّز بلمحة. */
export const ORDER_SOURCE_BADGE_CLASSES: Record<OrderSource, string> = {
  website: "bg-neutral-100 text-neutral-600",
  whatsapp: "bg-green-50 text-green-700",
  phone: "bg-blue-50 text-blue-700",
  store: "bg-purple-50 text-purple-700",
  other: "bg-neutral-100 text-neutral-600",
};

export function isOrderSource(value: unknown): value is OrderSource {
  return typeof value === "string" && (ORDER_SOURCES as readonly string[]).includes(value);
}

export function isManualOrderSource(value: unknown): value is Exclude<OrderSource, "website"> {
  return isOrderSource(value) && value !== "website";
}

/** تسمية آمنة لأي قيمة قادمة من القاعدة، بما فيها قيمة قديمة غير معروفة. */
export function orderSourceLabel(value: string | null | undefined): string {
  return isOrderSource(value) ? ORDER_SOURCE_LABELS[value] : "غير معروف";
}
