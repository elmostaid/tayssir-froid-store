import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendCapiEvent } from "@/lib/pixel/capi";
import { actionSourceForOrderSource } from "@/lib/pixel/actionSource";

/**
 * أداة اختبار داخلية: ترسل **بيعة واتساب اصطناعية** إلى Meta عبر Test Events.
 *
 * ## لماذا هي آمنة
 * - **مطفأة افتراضياً:** بلا `META_TEST_TRIGGER_TOKEN` في البيئة تجيب 404.
 * - **لا إرسال بلا رمز Test Events:** الحدث بلا `test_event_code` حدثٌ حقيقي
 *   في التقارير، فالطلب بلا رمز صالح يُرفض قبل أي نداء لـMeta.
 * - **لا قاعدة بيانات:** لا تقرأ طلبية ولا زبوناً. كل الحقول اصطناعية
 *   (هاتف تجريبي مُجزَّأ، منتج TEST، قيمة 1 درهم).
 * - **نفس المسار الحقيقي:** نفس `sendCapiEvent`، ونفس تحويل القناة
 *   (`whatsapp` ← `chat`) الذي تستعمله البيعة المؤكَّدة.
 *
 * تُحذف `META_TEST_TRIGGER_TOKEN` بعد الاختبار فتعود الأداة 404.
 */
const TEST_CODE = /^TEST[0-9A-Z]{2,20}$/;
const SYNTHETIC_PHONE = "212600000000";

function authorized(request: Request, expected: string): boolean {
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const token = process.env.META_TEST_TRIGGER_TOKEN?.trim();
  if (!token || token.length < 32) return NextResponse.json({ ok: false }, { status: 404 });
  if (!authorized(request, token)) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { testEventCode?: unknown } | null;
  const testEventCode = typeof body?.testEventCode === "string" ? body.testEventCode.trim().toUpperCase() : "";
  if (!TEST_CODE.test(testEventCode)) {
    return NextResponse.json({ ok: false, error: "testEventCode مطلوب (TEST…) — بدونه يصير الحدث حقيقياً" }, { status: 400 });
  }

  const actionSource = actionSourceForOrderSource("whatsapp");
  if (!actionSource) return NextResponse.json({ ok: false, error: "قناة واتساب غير معرَّفة" }, { status: 500 });

  const eventId = `test-purchase:${randomUUID()}`;
  const result = await sendCapiEvent({
    eventName: "Purchase",
    eventId,
    actionSource,
    testEventCode,
    userData: { phone: SYNTHETIC_PHONE, externalId: SYNTHETIC_PHONE, country: "ma" },
    customData: {
      content_ids: ["TEST-SKU"],
      content_type: "product",
      currency: "MAD",
      value: 1,
      num_items: 1,
      contents: [{ id: "TEST-SKU", quantity: 1, item_price: 1 }],
    },
  });

  return NextResponse.json(
    { ok: result.ok, eventsReceived: result.eventsReceived ?? null, status: result.status ?? null, error: result.error ?? null, actionSource, eventId },
    { status: result.ok ? 200 : 502 }
  );
}
