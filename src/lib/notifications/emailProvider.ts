import type { NewOrderNotificationPayload, NotificationProvider, NotificationResult } from "@/lib/notifications/types";

// مزوّد بريد إلكتروني عبر Resend API (طلب HTTP بسيط، بدون أي مكتبة SMTP
// إضافية). لا يُستعمل أي Token داخل الكود — كل شيء من متغيرات البيئة.
// إذا لم تتوفر بيانات الاعتماد، يبقى المزوّد "غير مفعَّل" دون أي خطأ يوقف
// إنشاء الطلب نفسه.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ORDERS_NOTIFICATION_EMAIL = process.env.ORDERS_NOTIFICATION_EMAIL;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "orders@tayssirfroid.ma";

export const emailProvider: NotificationProvider = {
  name: "email",

  isConfigured() {
    return Boolean(RESEND_API_KEY && ORDERS_NOTIFICATION_EMAIL);
  },

  async sendNewOrderNotification(payload: NewOrderNotificationPayload): Promise<NotificationResult> {
    if (!this.isConfigured()) {
      return { provider: "email", sent: false, reason: "missing_credentials" };
    }

    const subject = `طلب جديد ${payload.orderNumber} — ${payload.customerName}`;
    const html = `
      <div dir="rtl" style="font-family: sans-serif; font-size: 14px;">
        <h2>طلب جديد من موقع Tayssir Froid</h2>
        <p><strong>رقم الطلب:</strong> ${payload.orderNumber}</p>
        <p><strong>الزبون:</strong> ${payload.customerName}</p>
        <p><strong>الهاتف:</strong> ${payload.customerPhone}</p>
        <p><strong>المدينة:</strong> ${payload.city}</p>
        <p><strong>المجموع:</strong> ${payload.itemsSubtotal} درهم</p>
        <p><strong>عدد الأصناف:</strong> ${payload.itemsCount}</p>
        <p><a href="${payload.adminOrderUrl}">فتح الطلب في لوحة الإدارة</a></p>
        <p><a href="${payload.pickingSlipUrl}">تحميل بون التحضير</a></p>
      </div>
    `;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM_EMAIL,
          to: [ORDERS_NOTIFICATION_EMAIL],
          subject,
          html,
        }),
      });

      if (!response.ok) {
        console.error("emailProvider: فشل إرسال البريد", response.status, await response.text());
        return { provider: "email", sent: false, reason: `http_${response.status}` };
      }

      return { provider: "email", sent: true };
    } catch (error) {
      console.error("emailProvider: خطأ غير متوقع", error);
      return { provider: "email", sent: false, reason: "network_error" };
    }
  },
};
