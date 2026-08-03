// قائمة حالات الطلب وحدها، بدون أي استيراد لـ@/lib/db (postgres) — حتى يمكن
// استيرادها بأمان من مكوّنات عميل ("use client") مثل نماذج تغيير الحالة.
export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// مصدر وحيد لتسميات الحالة بالعربية — يُستعمل في كل مكان (قائمة الطلبات،
// صفحة تفاصيل الطلب، نموذج تغيير الحالة، سجل الحالات) بدل تكرار نفس
// القاموس في عدة ملفات (كان يسبب تعارضاً عند إضافة/حذف حالة).
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "جديد",
  confirmed: "تم التأكيد",
  preparing: "قيد التجهيز",
  shipped: "تم الإرسال",
  delivered: "تم التسليم",
  cancelled: "ملغى",
};

export const ORDER_STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
  new: "bg-brand-orange/10 text-brand-orange-dark",
  confirmed: "bg-brand-turquoise-tint text-brand-turquoise-dark",
  preparing: "bg-amber-100 text-amber-700",
  shipped: "bg-indigo-100 text-indigo-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};
