import { sql } from "@/lib/db";
import { createManualOrder, type ManualOrderInput, type ManualOrderResult } from "@/lib/orders/createManualOrder";
import type { CreateOrderFieldError } from "@/lib/orders/types";

/**
 * تحويل whatsapp_lead إلى طلب حقيقي (TF-2026-XXXX) — عبر createManualOrder
 * الموجود أصلاً، بلا أي مسار كتابة ثانٍ. هذا الملف يضيف طبقة واحدة فقط:
 * **قفل ذرّي يمنع تحويل نفس الـlead مرتين، حتى لو وصل طلبان متزامنان
 * فعلياً في نفس اللحظة** (ضغطتان على "تحويل" من تبويبين، أو نقرة مزدوجة
 * سريعة على الزر).
 *
 * لماذا تحديث SQL واحد لا "تحقّق ثم تصرّف" في كود التطبيق: تحقّق كهذا
 * (SELECT status ثم IF pending THEN UPDATE) عرضة لسباق حقيقي — طلبان
 * يقرآن "whatsapp_pending" معاً قبل أن يكتب أيّهما شيئاً، فيمرّان كلاهما.
 * التحديث الذري أدناه (`UPDATE ... WHERE status = 'whatsapp_pending'`)
 * يترك لـPostgres وحده حسم من يفوز: الصف يُقفَل خلال المعاملة الأولى التي
 * تصله، والثانية تنتظر ثم تجد status صار 'converted' فلا تُطابق أي صف
 * (0 rows) — بلا أي إمكانية لتحويلين ناجحين لنفس الـlead.
 */

export type ConvertWhatsappLeadInput = Omit<ManualOrderInput, "source"> & {
  leadId: number;
};

export type ConvertWhatsappLeadResult =
  | { ok: true; orderId: number; orderNumber: string }
  | { ok: false; errors: CreateOrderFieldError[]; alreadyConverted?: boolean };

const ALREADY_CONVERTED: ConvertWhatsappLeadResult = {
  ok: false,
  alreadyConverted: true,
  errors: [
    {
      field: "general",
      message: "هذا الطلب حُوِّل مسبقاً إلى طلب (أو لم يعد بانتظار التحويل).",
    },
  ],
};

export async function convertWhatsappLeadToOrder(
  input: ConvertWhatsappLeadInput
): Promise<ConvertWhatsappLeadResult> {
  // القفل: الفوز الوحيد الممكن هنا هو صفّ واحد تحوَّل بنجاح من
  // whatsapp_pending إلى converted. أي محاولة أخرى — متزامنة أو لاحقة —
  // تصل بعد هذه اللحظة تجد status != 'whatsapp_pending' فتُرجع 0 صفوف.
  const claimed = await sql<{ id: number }[]>`
    update public.whatsapp_leads
    set status = 'converted'
    where id = ${input.leadId} and status = 'whatsapp_pending'
    returning id
  `;

  if (claimed.length === 0) {
    return ALREADY_CONVERTED;
  }

  let result: ManualOrderResult;
  try {
    // createManualOrder نفسه المستعمل لكل بيع خارج الموقع — بلا أي Purchase
    // ولا CAPI ولا حدث قياس داخلي (انظر توثيقه)، فتحويل هذا الـlead لا يمكن
    // أبداً أن يُضاعف حدث شراء: لا الإنشاء هنا ولا إنشاء الـlead نفسه
    // (createWhatsappLead) يستوردان sendCapiEvent إطلاقاً.
    result = await createManualOrder({
      customer: input.customer,
      source: "whatsapp",
      items: input.items,
      deliveryFee: input.deliveryFee,
      actualDeliveryCost: input.actualDeliveryCost,
      createdByEmail: input.createdByEmail,
      acknowledgeBelowCost: input.acknowledgeBelowCost,
    });
  } catch (error) {
    // فشل غير متوقّع — نُعيد الحالة كما كانت قبل رفع الاستثناء، فلا يبقى
    // الـlead "مُقفلاً" بلا طلب حقيقي وبلا أي فرصة لإعادة المحاولة.
    await releaseClaim(input.leadId);
    throw error;
  }

  if (!result.ok) {
    // فشل الإنشاء (مخزون تغيّر، بيع تحت التكلفة بلا إقرار...) — الـlead
    // ليس "محوَّلاً" فعلياً؛ نُعيد حالته حتى يظهر مجدداً بانتظار التحويل
    // ويستطيع المدير إصلاح الخطأ والمحاولة من جديد.
    await releaseClaim(input.leadId);
    return result;
  }

  // الربط الدائم بين W-XXXXXXXX وTF-2026-XXXX — يمنع أي تحويل لاحق (حتى
  // لو أُعيدت الحالة يدوياً يوماً) من فقدان الإشارة إلى الطلب الأصلي.
  await sql`
    update public.whatsapp_leads
    set converted_order_id = ${result.orderId}
    where id = ${input.leadId}
  `;

  return { ok: true, orderId: result.orderId, orderNumber: result.orderNumber };
}

async function releaseClaim(leadId: number): Promise<void> {
  await sql`
    update public.whatsapp_leads
    set status = 'whatsapp_pending'
    where id = ${leadId} and status = 'converted'
  `;
}
