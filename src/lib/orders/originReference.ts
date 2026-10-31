import type { Sql, TransactionSql } from "postgres";
import { parseOriginReference } from "@/lib/whatsappInquiry";
import { parseAdConsent, type AdConsent } from "@/lib/privacy/consent";

type Trx = TransactionSql<Record<string, unknown>> | Sql<Record<string, unknown>>;

/**
 * ربط طلبية يدوية بالزيارة التي جاءت منها — داخل معاملة إنشائها.
 *
 * ## ما يُنسَخ، ولماذا هذا فقط
 *
 * الإسناد (UTM ومعرّفات النقر) وهوية المتصفح والموافقة، **كما سُجِّلت لحظة
 * الضغط في متصفح الزبون**. لا شيء يُستنتج: مرجعٌ غير موجود أو مستعمل يرفض
 * الطلبية بخطأ صريح بدل إنشائها بإسناد مُفترَض. والقناة (`source`) لا
 * تُلمس — الطلبية تبقى `whatsapp` مهما كان مصدرها الإعلاني.
 *
 * ## مرة واحدة
 *
 * كل مرجع يُربط بطلبية واحدة: التحديث الذرّي `where converted_order_id is
 * null` يحسم أي سباق، فطلبيتان لا تنسبان نفسيهما لنفس الزيارة.
 */

export class OriginReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginReferenceError";
  }
}

export type OrderOrigin = {
  reference: string;
  attributionFirst: unknown;
  attributionLast: unknown;
  capiIdentity: unknown;
  adConsent: AdConsent;
};

type OriginRow = {
  reference: string;
  attribution_first: unknown;
  attribution_last: unknown;
  capi_identity: unknown;
  ad_consent: string;
};

function toOrigin(row: OriginRow): OrderOrigin {
  return {
    reference: row.reference,
    attributionFirst: row.attribution_first,
    attributionLast: row.attribution_last,
    capiIdentity: row.capi_identity,
    adConsent: parseAdConsent(row.ad_consent),
  };
}

/** مرجع يلصقه المدير (Q- أو W-). نصٌّ فارغ ⇒ لا ربط، لا خطأ. */
export async function linkOriginByReference(
  trx: Trx,
  orderId: number,
  rawReference: string | null | undefined
): Promise<OrderOrigin | null> {
  if (!rawReference?.trim()) return null;
  const reference = parseOriginReference(rawReference);
  if (!reference) {
    throw new OriginReferenceError("المرجع غير صالح — الصيغة Q-XXXXXXXXXX أو W-XXXXXXXX.");
  }

  if (reference.startsWith("Q-")) {
    const [row] = await trx<OriginRow[]>`
      update public.whatsapp_inquiries
      set converted_order_id = ${orderId}
      where reference = ${reference} and converted_order_id is null
      returning reference, attribution_first, attribution_last, capi_identity, ad_consent
    `;
    if (row) return toOrigin(row);
    const [exists] = await trx<{ id: number }[]>`
      select id from public.whatsapp_inquiries where reference = ${reference}
    `;
    throw new OriginReferenceError(
      exists
        ? `المرجع ${reference} مربوط بطلبية أخرى.`
        : `المرجع ${reference} غير مسجَّل — ربما فتح الزبون الرابط دون ضغط الزرّ. احذفه وأنشئ الطلبية بلا مرجع.`
    );
  }

  // W-: سلة واتساب. المرجع ليس فريداً بقيد (ثماني خانات مشتقّة)، فنأخذ
  // أحدث lead معلّق بهذا المرجع — ونُحوّله في نفس الخطوة.
  const [row] = await trx<OriginRow[]>`
    update public.whatsapp_leads
    set status = 'converted', converted_order_id = ${orderId}
    where id = (
      select id from public.whatsapp_leads
      where reference = ${reference} and status = 'whatsapp_pending'
      order by created_at desc
      limit 1
    )
    returning reference, attribution_first, attribution_last, capi_identity, ad_consent
  `;
  if (row) return toOrigin(row);
  throw new OriginReferenceError(`لا سلة واتساب معلّقة بالمرجع ${reference}.`);
}

/** تحويل lead محدَّد (زرّ «تحويل») — حالته حُسمت مسبقاً بالقفل الذرّي. */
export async function linkOriginByLeadId(
  trx: Trx,
  orderId: number,
  leadId: number
): Promise<OrderOrigin> {
  const [row] = await trx<OriginRow[]>`
    update public.whatsapp_leads
    set converted_order_id = ${orderId}
    where id = ${leadId} and converted_order_id is null
    returning reference, attribution_first, attribution_last, capi_identity, ad_consent
  `;
  if (!row) throw new OriginReferenceError("هذه السلة مربوطة بطلبية أخرى.");
  return toOrigin(row);
}

/**
 * الموافقة النهائية للطلبية اليدوية.
 *
 * موروثة إن وافق الزائر في الموقع؛ وإلا ما صرّح به المدير بعد أن سأل
 * الزبون. والهوية تُنسَخ فقط مع موافقة موروثة: موافقة المدير تخصّ مشاركة
 * البيعة، لا كوكيز رفضها الزائر.
 */
export function manualOrderConsent(
  origin: OrderOrigin | null,
  adminDeclared: boolean
): { adConsent: AdConsent; source: "inherited" | "admin_declared" | null; copyIdentity: boolean } {
  if (origin?.adConsent === "granted") {
    return { adConsent: "granted", source: "inherited", copyIdentity: true };
  }
  if (adminDeclared) return { adConsent: "granted", source: "admin_declared", copyIdentity: false };
  return { adConsent: origin?.adConsent ?? "unknown", source: origin ? "inherited" : null, copyIdentity: false };
}
