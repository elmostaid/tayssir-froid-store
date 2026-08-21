import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import {
  MAX_EVENTS_PER_BATCH,
  MAX_TEXT_LENGTH,
  isAnalyticsEventName,
  type AnalyticsDeviceType,
  type AnalyticsEventName,
} from "@/lib/analytics/events";

/**
 * نقطة استقبال أحداث القياس الداخلي.
 *
 * تُستدعى عبر navigator.sendBeacon من المتصفح، فلا أحد ينتظر جوابها — لذلك
 * ترجع 204 بلا جسم، وتفشل بصمت (204 كذلك) عند أي خطأ. الهدف صريح: **لا شيء
 * هنا يمكن أن يظهر للزبون كخطأ**، لا في وحدة التحكم ولا كطلب فاشل أحمر.
 *
 * الحماية الحقيقية للجدول ليست هنا وحدها: قيد CHECK على event_name في
 * القاعدة نفسها يرفض أي اسم مخترع حتى لو مرّ من هذا الملف، وRLS مُفعَّل بلا
 * سياسات فلا يصل أحد الجدول عبر PostgREST بالمفتاح العام.
 */
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEVICE_TYPES = new Set<AnalyticsDeviceType>(["mobile", "tablet", "desktop"]);

// زحّافات محرّكات البحث ومعاينات الروابط (بما فيها معاينة فيسبوك وواتساب)
// تفتح الصفحة فعلاً وتُنفّذ جزءاً من JavaScript أحياناً. عدّها زواراً يُفسد
// كل نسبة تحويل في اللوحة، فنرفضها هنا قبل أي كتابة.
const BOT_UA_RE =
  /bot|crawler|spider|crawling|facebookexternalhit|whatsapp|slackbot|telegrambot|preview|lighthouse|headlesschrome|pingdom|gtmetrix|semrush|ahrefs|bingpreview/i;

function text(value: unknown, max = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function int(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  // حدّ معقول يمنع أي قيمة سخيفة من الوصول إلى عمود integer.
  if (rounded < 0 || rounded > 2_000_000_000) return null;
  return rounded;
}

function money(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 99_999_999) return null;
  return Math.round(value * 100) / 100;
}

type EventRow = {
  session_id: string;
  event_name: AnalyticsEventName;
  page_path: string | null;
  landing_path: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  has_click_id: boolean;
  device_type: AnalyticsDeviceType | null;
  browser: string | null;
  viewport_w: number | null;
  viewport_h: number | null;
  product_id: number | null;
  sku: string | null;
  quantity: number | null;
  cart_value: number | null;
  order_id: number | null;
  order_value: number | null;
  session_ms: number | null;
};

const ROW_COLUMNS = [
  "session_id",
  "event_name",
  "page_path",
  "landing_path",
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "has_click_id",
  "device_type",
  "browser",
  "viewport_w",
  "viewport_h",
  "product_id",
  "sku",
  "quantity",
  "cart_value",
  "order_id",
  "order_value",
  "session_ms",
] as const;

export async function POST(request: NextRequest) {
  try {
    const userAgent = request.headers.get("user-agent") ?? "";
    if (BOT_UA_RE.test(userAgent)) return new NextResponse(null, { status: 204 });

    const body = (await request.json()) as Record<string, unknown>;

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!UUID_RE.test(sessionId)) return new NextResponse(null, { status: 204 });

    const rawEvents = Array.isArray(body.events) ? body.events : [];
    if (rawEvents.length === 0) return new NextResponse(null, { status: 204 });

    const context = (body.context ?? {}) as Record<string, unknown>;
    const deviceRaw = body.deviceType;
    const deviceType =
      typeof deviceRaw === "string" && DEVICE_TYPES.has(deviceRaw as AnalyticsDeviceType)
        ? (deviceRaw as AnalyticsDeviceType)
        : null;

    // نُقدِّم مرجع الطلب إلى order_id مرة واحدة لكل دفعة. المرجع نفسه لا
    // يُخزَّن أبداً — يُستعمَل للبحث ثم يُرمى.
    const orderRefs = new Set<string>();
    for (const raw of rawEvents.slice(0, MAX_EVENTS_PER_BATCH)) {
      const ref = text((raw as Record<string, unknown>).orderRef, 64);
      if (ref) orderRefs.add(ref);
    }

    const orderIdByRef = new Map<string, number>();
    if (orderRefs.size > 0) {
      const found = await sql<{ id: number; public_reference: string }[]>`
        select id, public_reference from public.orders
        where public_reference = any(${[...orderRefs]})
      `;
      for (const row of found) orderIdByRef.set(row.public_reference, row.id);
    }

    const shared = {
      session_id: sessionId,
      landing_path: text(context.landingPath),
      referrer_host: text(context.referrerHost, 255),
      utm_source: text(context.utmSource, 128),
      utm_medium: text(context.utmMedium, 128),
      utm_campaign: text(context.utmCampaign, 191),
      utm_content: text(context.utmContent, 191),
      utm_term: text(context.utmTerm, 191),
      has_click_id: Boolean(context.hasClickId),
      device_type: deviceType,
      browser: text(body.browser, 32),
      viewport_w: int(body.viewportW),
      viewport_h: int(body.viewportH),
    };

    const rows: EventRow[] = [];
    for (const raw of rawEvents.slice(0, MAX_EVENTS_PER_BATCH)) {
      const event = raw as Record<string, unknown>;
      if (!isAnalyticsEventName(event.name)) continue;

      const ref = text(event.orderRef, 64);
      rows.push({
        ...shared,
        event_name: event.name,
        page_path: text(event.pagePath),
        product_id: int(event.productId),
        sku: text(event.sku, 64),
        quantity: int(event.quantity),
        cart_value: money(event.cartValue),
        order_id: ref ? (orderIdByRef.get(ref) ?? null) : null,
        order_value: money(event.orderValue),
        session_ms: int(event.sessionMs),
      });
    }

    if (rows.length === 0) return new NextResponse(null, { status: 204 });

    await sql`insert into public.analytics_events ${sql(rows, ...ROW_COLUMNS)}`;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    // نُسجّل في لوق الخادم فقط. الزائر لا يرى شيئاً، ولا يتغيّر أي سلوك في
    // الموقع لأن القياس فشل.
    console.error("api/analytics: تعذّر تسجيل أحداث القياس", error);
    return new NextResponse(null, { status: 204 });
  }
}
