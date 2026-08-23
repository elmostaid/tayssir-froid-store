import type { CartItem } from "@/lib/cart/types";
import { formatMad } from "@/lib/format";
import { buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * رسالة الطلب على واتساب — بسقف صارم لطول الرابط.
 *
 * الرسالة القديمة كانت تسرد كل سطر في السلة بالاسم الكامل داخل `?text=`،
 * والحرف العربي يصير 9 بايت بعد الترميز. قِسنا على كتالوغ Production: سلة
 * من 80 سطراً تُنتج رابطاً بـ17 كيلوبايت، وسلة تشمل الكتالوغ كله تصل إلى
 * 43 كيلوبايت. الزبون صاحب السلة الكبيرة كان يضغط الزر فيبقى على الموقع ثم
 * يرى "This page couldn't load" — بينما السلات الصغيرة تعمل. لذلك صار لطول
 * الرابط سقف لا يُتجاوَز أبداً، مهما كبرت السلة.
 *
 * وصيغتان لا واحدة، لأن الحفظ قد يفشل:
 *
 *  • **مؤكَّدة** — الطلب محفوظ فعلاً وله رقم. لا داعي لسرد المنتجات في
 *    واتساب، فالتفاصيل كلها في لوحة الإدارة تحت رقم الطلب.
 *
 *  • **إنقاذ** — لم يتأكّد الحفظ قبل خروج الزبون. هنا لا يجوز الاعتماد على
 *    قاعدة البيانات إطلاقاً: نضع محتوى الطلب في الرسالة نفسها، لكن بصيغة
 *    مضغوطة (SKU × الكمية) بلا أسماء طويلة — فتبقى الطلبية قابلة للتنفيذ
 *    يدوياً حتى لو ضاع الحفظ نهائياً.
 *
 * المرجع في الحالتين يُولَّد في المتصفح قبل أي اتصال بالخادم، فهو موجود حتى
 * حين لا يوجد رقم طلب إطلاقاً.
 */

/**
 * سقف طول رابط واتساب بالبايت.
 *
 * 3500 ليست رقماً اعتباطياً: تحت كل حدود المتصفحات ووسطاء الروابط المعروفة
 * بهامش واسع (السلة التي تعمل اليوم بلا شكوى تُنتج ~1.6 كيلوبايت)، وتكفي
 * لنحو 40 سطر SKU مضغوط في نسخة الإنقاذ.
 */
export const MAX_WHATSAPP_URL_BYTES = 3500;

const CLOSING_NOTE =
  "(المجموع لا يشمل التوصيل — يُحسب بعد تجهيز الطلب)";

/** مرجع قصير مقروء يُشتقّ من idempotencyKey، متاح قبل أي حفظ. */
export function orderReferenceFromKey(idempotencyKey: string): string {
  const compact = idempotencyKey.replace(/[^0-9a-fA-F]/g, "").slice(0, 8).toUpperCase();
  return `W-${compact || "00000000"}`;
}

export type MessageCustomer = {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  notes: string;
};

function customerLines(storeName: string, customer: MessageCustomer, reference: string): string[] {
  const lines = [
    `طلب جديد من موقع ${storeName}`,
    `المرجع: ${reference}`,
    "",
    `الاسم الكامل: ${customer.fullName}`,
    `الهاتف: ${customer.phone}`,
    `المدينة: ${customer.city}`,
    `العنوان: ${customer.address}`,
  ];
  if (customer.notes.trim()) lines.push(`ملاحظات: ${customer.notes.trim()}`);
  return lines;
}

/** الطلب محفوظ وله رقم — التفاصيل في اللوحة، فلا نكرّرها هنا. */
export function buildConfirmedOrderMessage(params: {
  storeName: string;
  customer: MessageCustomer;
  reference: string;
  orderNumber: string;
  items: CartItem[];
  subtotal: number;
}): string {
  const { storeName, customer, reference, orderNumber, items, subtotal } = params;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  return [
    ...customerLines(storeName, customer, reference),
    "",
    `رقم الطلب: ${orderNumber}`,
    `${items.length} منتجاً (${units} قطعة) — المجموع ${formatMad(subtotal)}`,
    "التفاصيل الكاملة محفوظة في لوحة الإدارة.",
    CLOSING_NOTE,
  ].join("\n");
}

/**
 * لم يتأكّد الحفظ — نحمل الطلب في الرسالة نفسها بصيغة مضغوطة.
 * تُقصَّر السطور عند بلوغ السقف، مع ذكر ما لم يُذكر صراحةً حتى لا يظن
 * الفريق أنه رأى الطلبية كاملة.
 */
export function buildRescueOrderMessage(params: {
  storeName: string;
  customer: MessageCustomer;
  reference: string;
  items: CartItem[];
  subtotal: number;
  whatsappNumber: string;
  maxUrlBytes?: number;
}): string {
  const { storeName, customer, reference, items, subtotal, whatsappNumber } = params;
  const budget = params.maxUrlBytes ?? MAX_WHATSAPP_URL_BYTES;
  const head = customerLines(storeName, customer, reference);
  const skuLines = items.map((item) => `${item.sku}×${item.quantity}`);

  const compose = (shown: string[], hiddenCount: number) => {
    const body = [
      ...head,
      "",
      `الطلبية (${items.length} منتجاً — لم يُؤكَّد حفظها، هذه نسخة إنقاذ):`,
      shown.join(" · "),
    ];
    if (hiddenCount > 0) {
      body.push(`… و${hiddenCount} منتجاً آخر — اتصلوا بالزبون لتأكيد الباقي.`);
    }
    body.push("", `المجموع ${formatMad(subtotal)}`, CLOSING_NOTE);
    return body.join("\n");
  };

  // نُنقص سطراً سطراً حتى يدخل الرابط تحت السقف. الحلقة تنتهي حتماً: أسوأ
  // حالة أن تبقى بيانات الزبون وحدها، وهي أهم ما يجب أن يصل.
  for (let shown = skuLines.length; shown >= 0; shown--) {
    const message = compose(skuLines.slice(0, shown), skuLines.length - shown);
    if (buildWhatsAppLink(whatsappNumber, message).length <= budget) return message;
  }
  return compose([], skuLines.length);
}
