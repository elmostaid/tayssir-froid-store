import { cache } from "react";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { CATALOG_TAG, CATALOG_REVALIDATE_SECONDS } from "@/lib/queries/catalogCache";

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

// مُغلَّفة بـcache() (تخزين مؤقَّت لعمر الطلب الواحد من React) — SiteHeader
// وSiteFooter وكل صفحة عامة (وبعض صفحات الإدارة) يستدعون getSettings()
// مستقلّين عن بعضهم؛ بدون هذا، عرض صفحة واحدة (مثلاً /category/x) كان
// يُنفِّذ استعلام settings المتطابق 3 مرات فعلياً (SiteHeader + SiteFooter
// + الصفحة نفسها). نفس النتيجة بالضبط فكل مرة، فقط استعلام واحد فعلي بدل
// عدة — يقلّل عدد الاتصالات المتزامنة اللازمة لكل زيارة، وهو أحد أسباب
// تراكم التأخير عند تدهور قاعدة البيانات (انظر db.ts لشرح statement_timeout،
// السبب الجذري الأساسي للعطل).
// إضافة إلى cache() أعلاه (طلب واحد)، نُخزِّن النتيجة عبر الطلبات كلها:
// هذا الاستعلام كان الأكثر تكراراً على الإطلاق في القاعدة (4,414 استدعاءً)
// رغم أن جدول settings سبعة صفوف لا تتغيّر إلا حين يُعدّلها المدير. يشترك
// في نفس وسم الكتالوج، فإجراء الإعدادات (الذي يستدعي revalidateCatalog)
// يُظهر أي تعديل فوراً.
const querySettings = unstable_cache(
  async () => sql<{ key: string; value: unknown }[]>`
    select key, value from public.settings
  `,
  ["store-settings"],
  { tags: [CATALOG_TAG], revalidate: CATALOG_REVALIDATE_SECONDS }
);

export const getSettings = cache(async (): Promise<StoreSettings> => {
  const rows = await querySettings();
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
});
