import type { CartItem } from "@/lib/cart/types";
import { formatMad } from "@/lib/format";
import { toInternationalDigits } from "@/lib/phone";

// رقم واتساب Tayssir Froid بصيغة دولية بدون علامة + (كما يتطلبه رابط wa.me)
const WHATSAPP_NUMBER = "212722083458";

export function buildWhatsAppLink(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function buildProductWhatsAppLink(productName: string, sku: string): string {
  return buildWhatsAppLink(`مرحباً، أريد الاستفسار عن المنتج: ${productName} (${sku})`);
}

// رابط واتساب من لوحة الإدارة إلى **الزبون نفسه** (رقمه من الطلب)، وليس إلى
// رقم المتجر — يُستعمل من صفحة تفاصيل الطلب فقط للتواصل المباشر بشأن طلبه.
export function buildCustomerWhatsAppLink(customerPhone: string, orderNumber: string): string {
  const digits = toInternationalDigits(customerPhone);
  const message = `مرحباً، بخصوص طلبكم رقم ${orderNumber} في Tayssir Froid.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// رسالة طلب جاهزة عبر واتساب — تُستعمل كبديل مؤقت لإتمام الطلب عندما يكون
// الحفظ المباشر فقاعدة البيانات غير متاح، حتى لا يبقى الزبون بلا طريقة
// لإرسال طلبه. لا تستبدل نظام الطلبات الحقيقي (لوحة الإدارة، رقم الطلب،
// حجز المخزون) — فقط تُرسل نفس المعلومات لفريق المبيعات مباشرة عبر واتساب
// ليُتابعوها يدوياً.
export function buildOrderWhatsAppMessage(params: {
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
  const { customer, items, subtotal } = params;
  const lines: string[] = [
    "طلب جديد من موقع Tayssir Froid",
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
