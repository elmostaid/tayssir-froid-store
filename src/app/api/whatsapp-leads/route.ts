import { NextResponse } from "next/server";
import { createWhatsappLead } from "@/lib/orders/createWhatsappLead";
import { parseItems } from "@/lib/orders/webCheckout";
import { readOrderRequestContext } from "@/lib/orders/requestContext";
import { sanitizeAttribution } from "@/lib/attribution/types";

export const dynamic = "force-dynamic";

/**
 * تسجيل سلة "أكمل الطلب عبر واتساب" — يُستدعى من CartWhatsAppButton مع
 * keepalive:true قبل فتح واتساب مباشرة، بنفس فلسفة /api/orders: لا ننتظر
 * جوابه، والمتصفح يتكفّل بإتمام الطلب حتى بعد مغادرة الصفحة إلى واتساب.
 *
 * لا Purchase ولا CAPI هنا إطلاقاً بتصميم الدالة نفسها — انظر
 * createWhatsappLead. هذا المسار لا يُنشئ طلباً حقيقياً ولا يمسّ المخزون.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, errors: [{ field: "items", message: "طلب غير صالح." }] },
      { status: 400 }
    );
  }

  const items = parseItems(body.cartItems);
  if (!items) {
    return NextResponse.json({
      ok: false,
      errors: [{ field: "items", message: "تعذّر قراءة محتوى السلة." }],
    });
  }

  // نفس مصدر السياق المستعمل فـ/api/orders (كوكي الجلسة)، لا حقلاً يرسله
  // المتصفح فالجسم — مصدر واحد لا يفترقان.
  const requestContext = await readOrderRequestContext();

  const result = await createWhatsappLead({
    items,
    idempotencyKey: String(body.idempotencyKey ?? ""),
    attribution: sanitizeAttribution(body.attribution),
    analyticsSessionId: requestContext?.analyticsSessionId,
  });

  return NextResponse.json(result);
}
