import { sql } from "@/lib/db";

export type StoreSettings = {
  minOrderAmountMad: number;
  deliveryFeePerCartonMad: number;
  whatsappNumber: string;
  storeCity: string;
  storeName: string;
  // القالب المستعمل فقط لرسالة واتساب "من الإدارة إلى الزبون" المرتبطة
  // بطلب محدَّد (CopyBonButton/زر واتساب الزبون فصفحة تفاصيل الطلب) —
  // {orderNumber} و{storeName} يُستبدَلان فعلياً وقت البناء. لا علاقة له
  // برسالة الطلب التي يبنيها الزبون نفسه عند إتمام الشراء (تلك رسالة مُولَّدة
  // ببيانات السلة الكاملة، وليست قالب نص بسيط قابل للتحرير هنا).
  whatsappOrderMessageTemplate: string;
  // متوقف = لا يمكن إتمام أي طلب جديد (الدفع عند الاستلام هو الطريقة
  // الوحيدة المتوفرة فعلياً فهذا المشروع، فتعطيله يعني إيقاف استقبال طلبات
  // جديدة مؤقتاً — انظر الشرح الكامل فـ CheckoutClient.tsx وcreateOrder.ts).
  codEnabled: boolean;
};

// قيم احتياطية فقط في حال غاب مفتاح ما استثنائياً من جدول settings، أو فشل
// الاتصال بالكامل (عبر safeQuery فكل صفحات الواجهة العامة) — المصدر الحقيقي
// دائماً هو قاعدة البيانات وليس هذه الثوابت. مُصدَّرة حتى تُستعمل كقيمة
// fallback واحدة موحَّدة فكل مكان يستدعي getSettings() عبر safeQuery، بدل
// تكرار نفس الكائن بحقوله السبعة فكل ملف.
export const FALLBACK_SETTINGS: StoreSettings = {
  minOrderAmountMad: 1000,
  deliveryFeePerCartonMad: 45,
  whatsappNumber: "+212722083458",
  storeCity: "مراكش - حي المحاميد",
  storeName: "Tayssir Froid",
  whatsappOrderMessageTemplate: "مرحباً، بخصوص طلبكم رقم {orderNumber} في {storeName}.",
  codEnabled: true,
};

export async function getSettings(): Promise<StoreSettings> {
  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from public.settings
  `;
  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    minOrderAmountMad: Number(
      map.get("min_order_amount_mad") ?? FALLBACK_SETTINGS.minOrderAmountMad
    ),
    deliveryFeePerCartonMad: Number(
      map.get("delivery_fee_per_carton_mad") ??
        FALLBACK_SETTINGS.deliveryFeePerCartonMad
    ),
    whatsappNumber: String(
      map.get("whatsapp_number") ?? FALLBACK_SETTINGS.whatsappNumber
    ),
    storeCity: String(map.get("store_city") ?? FALLBACK_SETTINGS.storeCity),
    storeName: String(map.get("store_name") ?? FALLBACK_SETTINGS.storeName),
    whatsappOrderMessageTemplate: String(
      map.get("whatsapp_order_message_template") ??
        FALLBACK_SETTINGS.whatsappOrderMessageTemplate
    ),
    codEnabled: Boolean(
      map.has("cod_enabled") ? map.get("cod_enabled") : FALLBACK_SETTINGS.codEnabled
    ),
  };
}
