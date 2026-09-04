import { formatMad } from "@/lib/format";

/**
 * هل التوصيل مجاني؟ — سؤال واحد، جواب واحد، لكل الموقع.
 *
 * الجواب مشتقّ دائماً من الإعداد المركزي `delivery_fee_per_carton_mad` في
 * جدول settings، **ولا يُكتب في الكود أبداً**. وهذا هو بيت القصيد: يوم
 * يقرّر صاحب المتجر إرجاع رسوم التوصيل، يكفيه أن يكتب الرقم في
 * /admin/settings فتعود كل الجمل في الموقع — السلة، إتمام الطلب، الفاتورة،
 * رسالة واتساب، تذييل الصفحة — إلى صيغتها القديمة بلا نشر ولا تعديل سطر
 * واحد. ولو كُتبت «مجاناً» نصّاً ثابتاً في اثني عشر موضعاً، لصار الرجوع عن
 * القرار مشروعاً برمجياً كاملاً، ولبقي حتماً موضعٌ منسيّ يناقض البقية أمام
 * عين الزبون.
 *
 * والصفر هنا يعني «مجاني» بحقّ: الزبون لا يدفع شيئاً مقابل التوصيل. وهو
 * منفصل تماماً عن `orders.actual_delivery_cost` — ما ندفعه نحن لشركة
 * التوصيل، وهو مصروف حقيقي مستمرّ يُسجَّل كما كان (انظر lib/orders/
 * deliveryCost.ts). مجانيةُ التوصيل على الزبون لا تجعل تكلفته علينا صفراً،
 * ولا يجوز أن يُفهم أحدهما من الآخر.
 */
export function isFreeDelivery(feePerCartonMad: number): boolean {
  return !Number.isFinite(feePerCartonMad) || feePerCartonMad <= 0;
}

/** الجملة الترويجية القصيرة — الصفحة الرئيسية وصفحة المنتج والتذييل. */
export const FREE_DELIVERY_HEADLINE = "التوصيل بالمجان لجميع مدن المغرب";

/** سطر «التوصيل» في ملخّص السعر: «مجاناً» أو المبلغ. */
export function deliveryAmountLabel(feePerCartonMad: number): string {
  return isFreeDelivery(feePerCartonMad) ? "مجاناً" : formatMad(feePerCartonMad);
}

/**
 * السطر الذي يُذيَّل به كل مجموع يراه الزبون (واتساب، الفاتورة، صفحة
 * الطلب): إما تطمين بأن المبلغ نهائي، أو التحفّظ القديم بأن التوصيل
 * سيُضاف لاحقاً.
 */
export function totalDeliveryNote(feePerCartonMad: number): string {
  return isFreeDelivery(feePerCartonMad)
    ? "(التوصيل بالمجان — هذا هو المبلغ النهائي، الدفع عند الاستلام)"
    : "(المجموع لا يشمل التوصيل — يُحسب بعد تجهيز الطلب)";
}
