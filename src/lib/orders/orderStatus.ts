// قائمة حالات الطلب وحدها، بدون أي استيراد لـ@/lib/db (postgres) — حتى يمكن
// استيرادها بأمان من مكوّنات عميل ("use client") مثل نماذج تغيير الحالة.
export const ORDER_STATUSES = [
  "new",
  "contacted",
  "confirmed",
  "preparing",
  "ready",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
