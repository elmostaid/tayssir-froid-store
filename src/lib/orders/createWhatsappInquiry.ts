import { sql } from "@/lib/db";
import { sanitizeAttribution } from "@/lib/attribution/types";
import { attributionForConsent } from "@/lib/privacy/attribution";
import { parseAdConsent } from "@/lib/privacy/consent";
import { capiIdentityFromRequest } from "@/lib/pixel/identity";
import { inquiryReferenceFromKey, isInquiryKind } from "@/lib/whatsappInquiry";
import type { CreateOrderRequestContext } from "@/lib/orders/types";

/**
 * تسجيل استفسار واتساب لحظة الضغط — قبل أن تبدأ المحادثة.
 *
 * ليس طلبية ولا lead: لا منتجات ولا ثمن ولا زبون. فقط **دليل الزيارة**:
 * من أي صفحة، وبأي إسناد، وبأي موافقة. هذا ما يُنسَخ إلى الطلبية حين يلصق
 * المدير المرجع — ولا شيء غيره يُنسَخ.
 *
 * المرجع يُشتقّ على الخادم من المفتاح نفسه، لا يُقرأ مما يرسله المتصفح:
 * لا يمكن تسجيل مرجعٍ لا يطابق مفتاحه.
 */

export type CreateWhatsappInquiryInput = {
  idempotencyKey: unknown;
  kind: unknown;
  productSku?: unknown;
  pagePath?: unknown;
  attribution?: unknown;
  requestContext?: CreateOrderRequestContext;
};

export type CreateWhatsappInquiryResult =
  | { ok: true; reference: string; isNew: boolean }
  | { ok: false; error: "invalid" | "reference_conflict" | "failed" };

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

/** مسار داخلي فقط: لا نطاق، ولا بارامترات (قد تحمل معرّفات نقر). */
function cleanPagePath(value: unknown): string | null {
  const text = cleanText(value, 200);
  if (!text || !text.startsWith("/") || text.startsWith("//")) return null;
  return text.split(/[?#]/)[0] || "/";
}

export async function createWhatsappInquiry(
  input: CreateWhatsappInquiryInput
): Promise<CreateWhatsappInquiryResult> {
  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  const reference = inquiryReferenceFromKey(key);
  if (!reference || !isInquiryKind(input.kind)) return { ok: false, error: "invalid" };

  const adConsent = parseAdConsent(input.requestContext?.adConsent);
  const attribution = attributionForConsent(sanitizeAttribution(input.attribution), adConsent);
  const identity = capiIdentityFromRequest(
    input.requestContext,
    attribution?.last ?? attribution?.first ?? null
  );

  try {
    const inserted = await sql<{ id: number }[]>`
      insert into public.whatsapp_inquiries (
        reference, idempotency_key, kind, product_sku, page_path,
        attribution_first, attribution_last, capi_identity, ad_consent, analytics_session_id
      ) values (
        ${reference}, ${key.toLowerCase()}, ${input.kind},
        ${input.kind === "product" ? cleanText(input.productSku, 64) : null},
        ${cleanPagePath(input.pagePath)},
        ${attribution?.first ? sql.json(attribution.first) : null},
        ${attribution?.last ? sql.json(attribution.last) : null},
        ${identity ? sql.json(identity) : null},
        ${adConsent},
        ${input.requestContext?.analyticsSessionId ?? null}
      )
      on conflict (idempotency_key) do nothing
      returning id
    `;
    return { ok: true, reference, isNew: inserted.length > 0 };
  } catch (error) {
    // مفتاحان مختلفان بنفس المرجع (نادر جداً بعشر خانات): الثاني لا يُسجَّل
    // أبداً — ربطُه سيكون بزيارة غيره.
    if ((error as { code?: string }).code === "23505") {
      console.error(`createWhatsappInquiry: تعارض مرجع ${reference} — لم يُسجَّل`);
      return { ok: false, error: "reference_conflict" };
    }
    console.error("createWhatsappInquiry: خطأ غير متوقع", error);
    return { ok: false, error: "failed" };
  }
}
