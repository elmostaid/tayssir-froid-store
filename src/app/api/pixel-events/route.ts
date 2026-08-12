import { NextResponse, type NextRequest } from "next/server";
import { sendCapiEvent } from "@/lib/pixel/capi";

// رابط خاص داخلي: fbq.ts (طبقة Pixel من المتصفح) يستدعيه مباشرة بعد كل
// PageView/ViewContent/AddToCart/InitiateCheckout — يُعيد إرسال نفس الحدث
// (بنفس event_id) إلى Meta Conversions API من جهة الخادم، لتفعيل
// deduplication الصحيح بين Pixel وCAPI. Purchase مستثنى عمداً هنا: تُرسَل
// من createOrder.ts مباشرة (أوثق، فقط بعد نجاح حقيقي للطلب — انظر هناك).
export const runtime = "nodejs";

// قائمة مغلقة صراحة — أي اسم حدث آخر يُرفَض قبل أي محاولة إرسال لـMeta.
const ALLOWED_EVENT_NAMES = new Set(["PageView", "ViewContent", "AddToCart", "InitiateCheckout"]);

type RelayBody = {
  eventName?: unknown;
  eventId?: unknown;
  eventSourceUrl?: unknown;
  customData?: {
    content_ids?: unknown;
    value?: unknown;
    contents?: unknown;
    num_items?: unknown;
    content_name?: unknown;
    content_category?: unknown;
  };
};

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((v): v is string => typeof v === "string");
  return strings.length > 0 ? strings : undefined;
}

function sanitizeContents(
  value: unknown
): { id: string; quantity: number; item_price: number }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const contents = value
    .filter(
      (v): v is { id: unknown; quantity: unknown; item_price: unknown } =>
        typeof v === "object" && v !== null
    )
    .map((v) => ({
      id: typeof v.id === "string" ? v.id : "",
      quantity: typeof v.quantity === "number" ? v.quantity : 0,
      item_price: typeof v.item_price === "number" ? v.item_price : 0,
    }))
    .filter((c) => c.id);
  return contents.length > 0 ? contents : undefined;
}

export async function POST(request: NextRequest) {
  let body: RelayBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const eventName = typeof body.eventName === "string" ? body.eventName : "";
  const eventId = typeof body.eventId === "string" ? body.eventId : "";

  if (!ALLOWED_EVENT_NAMES.has(eventName) || !eventId) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  // content_type/currency ثابتان دائماً من الخادم — لا نثق بهما من العميل
  // حتى لو لم يكونا حسّاسين (تناسقاً مع باقي أحداث Meta فالمشروع).
  const customData: Record<string, unknown> =
    eventName === "PageView"
      ? {}
      : {
          content_type: "product",
          currency: "MAD",
          content_ids: sanitizeStringArray(body.customData?.content_ids),
          value: typeof body.customData?.value === "number" ? body.customData.value : undefined,
          contents: sanitizeContents(body.customData?.contents),
          num_items: typeof body.customData?.num_items === "number" ? body.customData.num_items : undefined,
          content_name:
            typeof body.customData?.content_name === "string" ? body.customData.content_name : undefined,
          content_category:
            typeof body.customData?.content_category === "string"
              ? body.customData.content_category
              : undefined,
        };

  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIpAddress = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined;
  const clientUserAgent = request.headers.get("user-agent") || undefined;
  const fbp = request.cookies.get("_fbp")?.value;
  const fbc = request.cookies.get("_fbc")?.value;
  const eventSourceUrl = typeof body.eventSourceUrl === "string" ? body.eventSourceUrl : undefined;

  // fire-and-forget فعلياً من جهة الاستدعاء (fbq.ts لا ينتظر هذا الطلب) —
  // sendCapiEvent نفسها لا ترمي أبداً، فننتظرها هنا فقط لضمان محاولة
  // الإرسال قبل إغلاق الاستجابة، بلا أي خطر على الصفحة المستدعية.
  await sendCapiEvent({
    eventName,
    eventId,
    eventSourceUrl,
    userData: { clientIpAddress, clientUserAgent, fbp, fbc },
    customData,
  });

  return NextResponse.json({ ok: true });
}
