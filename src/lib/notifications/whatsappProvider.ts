import type { NewOrderNotificationPayload, NotificationProvider, NotificationResult } from "@/lib/notifications/types";

// مزوّد WhatsApp Business Platform Cloud API (رسمي من Meta) عبر HTTP مباشرة
// — بدون WhatsApp Web automation أو أي حل غير رسمي. لا Token داخل الكود.
// يبقى "غير مفعَّل" تلقائياً بدون الحاجة لأي Credentials حقيقية بعد؛ إرسال
// رسائل business-initiated خارج نافذة الـ24 ساعة يتطلب قالباً معتمداً من
// Meta (WHATSAPP_ORDER_TEMPLATE_NAME).
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ADMIN_PHONE = process.env.WHATSAPP_ADMIN_PHONE;
const WHATSAPP_ORDER_TEMPLATE_NAME = process.env.WHATSAPP_ORDER_TEMPLATE_NAME;

export const whatsappProvider: NotificationProvider = {
  name: "whatsapp",

  isConfigured() {
    return Boolean(
      WHATSAPP_ACCESS_TOKEN &&
        WHATSAPP_PHONE_NUMBER_ID &&
        WHATSAPP_ADMIN_PHONE &&
        WHATSAPP_ORDER_TEMPLATE_NAME
    );
  },

  async sendNewOrderNotification(payload: NewOrderNotificationPayload): Promise<NotificationResult> {
    if (!this.isConfigured()) {
      return { provider: "whatsapp", sent: false, reason: "missing_credentials" };
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: WHATSAPP_ADMIN_PHONE,
            type: "template",
            template: {
              name: WHATSAPP_ORDER_TEMPLATE_NAME,
              language: { code: "ar" },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: payload.orderNumber },
                    { type: "text", text: payload.customerName },
                    { type: "text", text: payload.customerPhone },
                    { type: "text", text: payload.city },
                    { type: "text", text: payload.itemsSubtotal },
                    { type: "text", text: String(payload.itemsCount) },
                    { type: "text", text: payload.adminOrderUrl },
                    { type: "text", text: payload.pickingSlipUrl },
                  ],
                },
              ],
            },
          }),
        }
      );

      if (!response.ok) {
        console.error("whatsappProvider: فشل إرسال الرسالة", response.status, await response.text());
        return { provider: "whatsapp", sent: false, reason: `http_${response.status}` };
      }

      return { provider: "whatsapp", sent: true };
    } catch (error) {
      console.error("whatsappProvider: خطأ غير متوقع", error);
      return { provider: "whatsapp", sent: false, reason: "network_error" };
    }
  },
};
