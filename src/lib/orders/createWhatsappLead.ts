import { sql } from "@/lib/db";
import { resolveOrderLines, WHATSAPP_LEAD_LINE_RULES } from "@/lib/orders/resolveLines";
import { orderReferenceFromKey } from "@/lib/orders/orderMessage";
import { sanitizeAttribution } from "@/lib/attribution/types";
import type { CartItemInput, CreateOrderFieldError } from "@/lib/orders/types";
import type { OrderAttribution } from "@/lib/attribution/types";

/**
 * تسجيل سلة "أكمل الطلب عبر واتساب" في قاعدة البيانات **قبل** فتح واتساب.
 *
 * هذا ليس createOrder: لا زبون معروفاً بعد، لا حجز مخزون، لا حدث Purchase
 * ولا CAPI — فقط دليل أن السلة وصلت، بنفس منطق exactly-once المستعمل في
 * createOrder (ON CONFLICT DO NOTHING على مفتاح فريد)، حتى لا يُسجَّل نفس
 * الضغط مرتين لا في قاعدة البيانات ولا برقمين مختلفين لنفس الزبون.
 *
 * المرجع (W-XXXXXXXX) يُشتقّ من idempotencyKey على الخادم نفسه — لا يُقرأ
 * أبداً مما يرسله المتصفح، فيبقى متطابقاً حتماً مع ما بُني منه الطلب،
 * ولا يمكن انتحاله بإرسال مرجع مختلف عن نفس المفتاح.
 */

export type CreateWhatsappLeadInput = {
  items: CartItemInput[];
  idempotencyKey: string;
  attribution?: OrderAttribution | null;
  analyticsSessionId?: string;
};

export type CreateWhatsappLeadResult =
  | { ok: true; reference: string; isNew: boolean }
  | { ok: false; errors: CreateOrderFieldError[] };

const GENERIC_ERROR: CreateWhatsappLeadResult = {
  ok: false,
  errors: [{ field: "general", message: "تعذّر تسجيل السلة حالياً." }],
};

export async function createWhatsappLead(
  input: CreateWhatsappLeadInput
): Promise<CreateWhatsappLeadResult> {
  if (!input.idempotencyKey?.trim()) {
    return { ok: false, errors: [{ field: "general", message: "طلب غير صالح." }] };
  }
  if (!input.items || input.items.length === 0) {
    return { ok: false, errors: [{ field: "items", message: "السلة فارغة." }] };
  }

  const reference = orderReferenceFromKey(input.idempotencyKey);

  try {
    const { lines, rejected } = await resolveOrderLines(input.items, WHATSAPP_LEAD_LINE_RULES);

    // enforceAvailability/enforceQuantityRules معطَّلتان في
    // WHATSAPP_LEAD_LINE_RULES، فـ`rejected` تبقى عادةً فارغة؛ نضمّها مع
    // ذلك لأي حالة مستقبلية، فلا يضيع سطر وصل بحالته من resolveOrderLines.
    const allLines = [...lines, ...rejected.map((r) => r.line)];

    if (allLines.length === 0) {
      // كل المنتجات لم تعد موجودة في الكتالوج (حُذفت) — نادر، لكن سلة لا
      // نعرف عنها شيئاً لا تستحقّ سطراً في لوحة الإدارة.
      return {
        ok: false,
        errors: [{ field: "items", message: "تعذّر التعرّف على منتجات السلة." }],
      };
    }

    const subtotal = allLines.reduce((sum, line) => sum + line.lineTotal, 0);
    const itemsSnapshot = allLines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      name: line.nameSnapshot,
      sku: line.skuSnapshot,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
    }));

    const attribution = sanitizeAttribution(input.attribution);
    const attributionFirst = attribution?.first ? sql.json(attribution.first) : null;
    const attributionLast = attribution?.last ? sql.json(attribution.last) : null;

    const inserted = await sql<{ id: number }[]>`
      insert into public.whatsapp_leads (
        reference, idempotency_key, items, items_subtotal,
        attribution_first, attribution_last, analytics_session_id
      ) values (
        ${reference}, ${input.idempotencyKey}, ${sql.json(itemsSnapshot)}, ${subtotal},
        ${attributionFirst}, ${attributionLast}, ${input.analyticsSessionId ?? null}
      )
      on conflict (idempotency_key) do nothing
      returning id
    `;

    if (inserted.length > 0) {
      return { ok: true, reference, isNew: true };
    }

    // تعارض على idempotency_key => نفس الضغطة وصلت مسبقاً (ضغط مزدوج، أو
    // رجوع للسلة وإعادة الضغط بنفس محتواها). لا صفّ جديد، ونُعيد نفس
    // المرجع — وهو نفسه على أي حال لأنه دالة حتمية لنفس المفتاح.
    const existing = await sql<{ id: number }[]>`
      select id from public.whatsapp_leads where idempotency_key = ${input.idempotencyKey} limit 1
    `;
    if (existing[0]) return { ok: true, reference, isNew: false };

    return GENERIC_ERROR;
  } catch (error) {
    console.error("createWhatsappLead: خطأ غير متوقع", error);
    return GENERIC_ERROR;
  }
}
