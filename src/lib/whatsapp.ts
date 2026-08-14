import type { CartItem } from "@/lib/cart/types";
import { formatMad } from "@/lib/format";
import { toInternationalDigits } from "@/lib/phone";

// رقم واتساب المتجر ورسائله لم تعد ثوابت مكتوبة هنا — تأتي من settings
// (رقم واتساب المتجر) عبر getSettings()، من مصدر واحد فقط، حتى ينعكس أي
// تعديل من /admin/settings فعلاً على كل هذه الروابط دون استثناء.

// عمداً https://api.whatsapp.com/send وليس https://wa.me/<رقم>?text=... رغم
// أن الاثنين يفتحان نفس المحادثة على الهاتف (wa.me أصلاً مجرد مُقصِّر روابط
// يُعيد التوجيه إلى api.whatsapp.com/send نفسها) — على الحاسوب (بلا تطبيق
// واتساب مُثبَّت)، wa.me يمرّ عبر إعادة توجيه إضافية نحو صفحة وسيطة
// (api.whatsapp.com) قبل أن تفتح تلك الصفحة نفسها WhatsApp Web عبر زر
// "Continuer vers WhatsApp Web" — وفي هذه القفزة الإضافية تحديداً (مشكلة
// معروفة وموثَّقة كثيراً في تطبيقات الويب التي تستعمل روابط الدردشة
// المباشرة)، يضيع "text" أحياناً فرابط WhatsApp Web الناتج رغم وصول "phone"
// سليماً (المحادثة الصحيحة تُفتح، لكن خانة الكتابة فارغة). الرابط المباشر
// إلى api.whatsapp.com/send، بنفس صيغة معاملات أداة "Click to Chat" الرسمية
// من Meta (phone + text + type=phone_number + app_absent=0)، يتفادى هذه
// القفزة الوسيطة تماماً ويعمل بنفس الموثوقية على تطبيق واتساب (أندرويد/
// آيفون) وعلى WhatsApp Web، بلا أي تغيير على الرقم نفسه.
export function buildWhatsAppLink(whatsappNumber: string, message: string): string {
  const digits = toInternationalDigits(whatsappNumber);
  const params = new URLSearchParams({
    phone: digits,
    text: message,
    type: "phone_number",
    app_absent: "0",
  });
  return `https://api.whatsapp.com/send/?${params.toString()}`;
}

export function buildProductWhatsAppLink(
  whatsappNumber: string,
  productName: string,
  sku: string
): string {
  return buildWhatsAppLink(
    whatsappNumber,
    `مرحباً، أريد الاستفسار عن المنتج: ${productName} (${sku})`
  );
}

// رابط واتساب من لوحة الإدارة إلى **الزبون نفسه** (رقمه من الطلب)، وليس إلى
// رقم المتجر — يُستعمل من صفحة تفاصيل الطلب فقط للتواصل المباشر بشأن طلبه.
// template يأتي من settings.whatsappOrderMessageTemplate (قابل للتعديل من
// /admin/settings)، بمكانين قابلين للاستبدال: {orderNumber} و{storeName}.
export function buildCustomerWhatsAppLink(
  customerPhone: string,
  orderNumber: string,
  template: string,
  storeName: string
): string {
  const message = template
    .replaceAll("{orderNumber}", orderNumber)
    .replaceAll("{storeName}", storeName);
  return buildWhatsAppLink(customerPhone, message);
}

// رسالة طلب جاهزة عبر واتساب — تُستعمل كبديل مؤقت لإتمام الطلب عندما يكون
// الحفظ المباشر فقاعدة البيانات غير متاح، حتى لا يبقى الزبون بلا طريقة
// لإرسال طلبه. لا تستبدل نظام الطلبات الحقيقي (لوحة الإدارة، رقم الطلب،
// حجز المخزون) — فقط تُرسل نفس المعلومات لفريق المبيعات مباشرة عبر واتساب
// ليُتابعوها يدوياً. هذه رسالة مُولَّدة من بيانات السلة الكاملة (وليست قالب
// نص بسيط)، فتبقى غير قابلة للتعديل من الإعدادات — فقط اسم المتجر بداخلها
// يُقرأ من settings.storeName.
export function buildOrderWhatsAppMessage(params: {
  storeName: string;
  customer: {
    fullName: string;
    phone: string;
    city: string;
    address: string;
    notes: string;
  };
  items: CartItem[];
  subtotal: number;
}): string {
  const { storeName, customer, items, subtotal } = params;
  const lines: string[] = [
    `طلب جديد من موقع ${storeName}`,
    "",
    `الاسم الكامل: ${customer.fullName}`,
    `الهاتف: ${customer.phone}`,
    `المدينة: ${customer.city}`,
    `العنوان: ${customer.address}`,
  ];

  if (customer.notes.trim()) {
    lines.push(`ملاحظات: ${customer.notes.trim()}`);
  }

  lines.push("", "المنتجات:");
  for (const item of items) {
    const name = item.variantName ? `${item.name} — ${item.variantName}` : item.name;
    lines.push(
      `- ${name} (${item.sku}) × ${item.quantity} = ${formatMad(item.unitPrice * item.quantity)}`
    );
  }

  lines.push(
    "",
    `مجموع المنتجات: ${formatMad(subtotal)}`,
    "(هذا المجموع لا يشمل مصاريف التوصيل — ستُحسب بعد تجهيز الطلب وتحديد عدد الكرطونات، الدفع عند الاستلام)"
  );

  return lines.join("\n");
}
