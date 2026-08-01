import { emailProvider } from "@/lib/notifications/emailProvider";
import { whatsappProvider } from "@/lib/notifications/whatsappProvider";
import type { NewOrderNotificationPayload, NotificationResult } from "@/lib/notifications/types";

// إشعار "أفضل مجهود" (best-effort): يُستدعى بعد نجاح حفظ الطلب في قاعدة
// البيانات، ولا يمكنه أبداً التأثير على نتيجة الطلب نفسه — أي خطأ هنا
// يُسجَّل فقط في السجلات (logs) ولا يُعاد رفعه (throw) للخارج.
export async function notifyNewOrder(
  payload: NewOrderNotificationPayload
): Promise<NotificationResult[]> {
  const results = await Promise.all([
    emailProvider.sendNewOrderNotification(payload).catch((error) => {
      console.error("notifyNewOrder: خطأ غير متوقع من مزوّد البريد", error);
      return { provider: "email" as const, sent: false, reason: "unexpected_error" };
    }),
    whatsappProvider.sendNewOrderNotification(payload).catch((error) => {
      console.error("notifyNewOrder: خطأ غير متوقع من مزوّد واتساب", error);
      return { provider: "whatsapp" as const, sent: false, reason: "unexpected_error" };
    }),
  ]);

  for (const result of results) {
    if (!result.sent) {
      console.warn(
        `notifyNewOrder: إشعار ${result.provider} غير مفعَّل/فشل (${result.reason ?? "غير معروف"}) لطلب ${payload.orderNumber}`
      );
    }
  }

  return results;
}
