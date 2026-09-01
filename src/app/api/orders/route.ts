import { NextResponse } from "next/server";
import { runWebCheckout } from "@/lib/orders/webCheckout";
import { readOrderRequestContext } from "@/lib/orders/requestContext";

export const dynamic = "force-dynamic";

/**
 * إنشاء طلب الزبون من الموقع.
 *
 * لماذا مسار وليس Server Action كما كان: الزبون يغادر إلى واتساب فور الضغط،
 * وطلب Server Action يُقطع مع مغادرة الصفحة — فيضيع الطلب. هذا المسار
 * يُستدعى بـ`keepalive: true`، فيتكفّل المتصفح بإتمامه بعد أن تختفي الصفحة.
 *
 * لا يمنع هذا المسار الزبون من شيء: الواجهة لا تنتظر جوابه أكثر من مهلة
 * قصيرة، وما بعدها تمضي إلى واتساب وتترك الطلب يُحفظ في الخلفية.
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

  const result = await runWebCheckout(
    {
      cartItems: body.cartItems,
      fullName: body.fullName,
      phone: body.phone,
      city: body.city,
      address: body.address,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
      attribution: body.attribution,
    },
    await readOrderRequestContext()
  );

  // حتى الرفض يرجع 200: هذا جواب منطقي لا عطل في المسار، والواجهة تقرأ
  // `ok` لا رمز HTTP. الرموز 5xx تبقى للأعطال الحقيقية وحدها.
  return NextResponse.json(result);
}
