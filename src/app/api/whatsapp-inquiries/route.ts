import { NextResponse } from "next/server";
import { createWhatsappInquiry } from "@/lib/orders/createWhatsappInquiry";
import { readOrderRequestContext } from "@/lib/orders/requestContext";

export const dynamic = "force-dynamic";

/**
 * تسجيل استفسار واتساب — يُستدعى من WhatsAppInquiryLink بـkeepalive لحظة
 * الضغط، ولا أحد ينتظر جوابه: واتساب يُفتح على أي حال.
 *
 * لا Purchase ولا CAPI هنا: الاستفسار ليس بيعة. الهوية والموافقة تُقرآن من
 * كوكيز الطلب نفسه (readOrderRequestContext)، لا من الجسم.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const result = await createWhatsappInquiry({
    idempotencyKey: body.idempotencyKey,
    kind: body.kind,
    productSku: body.productSku,
    pagePath: body.pagePath,
    attribution: body.attribution,
    requestContext: await readOrderRequestContext(),
  });

  const status = result.ok
    ? 200
    : result.error === "invalid"
      ? 400
      : result.error === "reference_conflict"
        ? 409
        : 500;
  return NextResponse.json(result, { status });
}
