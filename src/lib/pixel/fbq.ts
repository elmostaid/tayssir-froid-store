// طبقة نداء Meta Pixel (fbq) الآمنة من جهة العميل فقط — لا تُستورَد أبداً من
// أي كود خادم (Server Component/Server Action). كل دالة هنا لا تفعل شيئاً
// بصمت إذا لم يُحمَّل سكريبت Pixel بعد (NEXT_PUBLIC_META_PIXEL_ID غير مضبوط،
// أو حاجب إعلانات، أو السكريبت لم يُنفَّذ بعد) — بلا أي استثناء يُسقط الصفحة.
declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const CONTENT_TYPE = "product" as const;
const CURRENCY = "MAD" as const;

// رابط داخلي يُعيد إرسال نفس الحدث (بنفس event_id) إلى Meta Conversions API
// من جهة الخادم — انظر src/app/api/pixel-events/route.ts. Purchase مستثنى
// عمداً من هذا المسار: تُرسَل من createOrder.ts مباشرة بعد نجاح حقيقي
// للطلب فقط (انظر trackPurchase أسفله).
const CAPI_RELAY_URL = "/api/pixel-events";

export type PixelContentItem = {
  sku: string;
  quantity: number;
  price: number;
};

function newEventId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function callFbq(eventName: string, params: Record<string, unknown>, eventId: string): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", eventName, params, { eventID: eventId });
}

// fire-and-forget حقيقي: لا يُنتظَر أبداً من أي دالة track* (لا يجب أن يُبطئ
// أو يُعطِّل أي تفاعل فالواجهة)، ولا يرمي أي استثناء — فشل الشبكة/الخادم هنا
// لا يظهر للزبون إطلاقاً ولا يؤثِّر على fbq() نفسها (نُفِّذت أصلاً قبله).
function relayToCapi(eventName: string, eventId: string, customData: Record<string, unknown>): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const body = JSON.stringify({
    eventName,
    eventId,
    eventSourceUrl: window.location.href,
    customData,
  });
  fetch(CAPI_RELAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // أفضل مجهود — لا شيء يُفعَل هنا عمداً.
  });
}

function contentsFromItems(items: PixelContentItem[]) {
  return items.map((item) => ({
    id: item.sku,
    quantity: item.quantity,
    item_price: item.price,
  }));
}

/** يُستدعى مرة واحدة فقط لكل عرض صفحة حقيقي (تحميل أول أو تنقّل SPA) — انظر PixelPageViewTracker.tsx للتحكم فـ"مرة واحدة فقط". */
export function trackPageView(): void {
  const eventId = newEventId();
  callFbq("PageView", {}, eventId);
  relayToCapi("PageView", eventId, {});
}

export function trackViewContent(params: {
  sku: string;
  name: string;
  price: number;
  category?: string | null;
}): void {
  const eventId = newEventId();
  const customData = {
    content_ids: [params.sku],
    content_name: params.name,
    content_category: params.category ?? undefined,
    content_type: CONTENT_TYPE,
    currency: CURRENCY,
    value: params.price,
  };
  callFbq("ViewContent", customData, eventId);
  relayToCapi("ViewContent", eventId, customData);
}

export function trackAddToCart(params: {
  sku: string;
  name: string;
  price: number;
  quantity: number;
  category?: string | null;
}): void {
  const eventId = newEventId();
  const customData = {
    content_ids: [params.sku],
    content_name: params.name,
    content_category: params.category ?? undefined,
    content_type: CONTENT_TYPE,
    contents: contentsFromItems([{ sku: params.sku, quantity: params.quantity, price: params.price }]),
    currency: CURRENCY,
    value: params.price * params.quantity,
  };
  callFbq("AddToCart", customData, eventId);
  relayToCapi("AddToCart", eventId, customData);
}

export function trackInitiateCheckout(params: {
  items: PixelContentItem[];
  value: number;
  eventId?: string;
}): void {
  const eventId = params.eventId ?? newEventId();
  const customData = {
    content_ids: params.items.map((i) => i.sku),
    content_type: CONTENT_TYPE,
    contents: contentsFromItems(params.items),
    num_items: params.items.reduce((sum, i) => sum + i.quantity, 0),
    currency: CURRENCY,
    value: params.value,
  };
  callFbq("InitiateCheckout", customData, eventId);
  relayToCapi("InitiateCheckout", eventId, customData);
}

/**
 * event_id هنا هو idempotencyKey نفسه المُستعمَل لضمان عدم تكرار الطلب فـ
 * createOrder — نفس القيمة بالضبط تُستعمَل من جهة الخادم (createOrder.ts)
 * لإرسال Purchase عبر Conversions API (CAPI) مباشرة بعد نجاح الطلب فعلاً،
 * ليقدر Meta على "deduplication" (اعتبار حدث Pixel وحدث CAPI لنفس عملية
 * الشراء حدثاً واحداً، لا حدثين). عمداً بلا relayToCapi هنا: نسخة CAPI من
 * Purchase تُرسَل من الخادم مباشرة (أوثق، لا تعتمد على نجاح الشبكة فالمتصفح
 * أو استمرار الصفحة قبل التنقّل نحو واتساب) — إرسالها هنا أيضاً كان سيُنتج
 * محاولتَي إرسال منفصلتين لنفس الحدث بلا أي فائدة إضافية.
 */
export function trackPurchase(params: { items: PixelContentItem[]; value: number; eventId: string }): void {
  callFbq(
    "Purchase",
    {
      content_ids: params.items.map((i) => i.sku),
      content_type: CONTENT_TYPE,
      contents: contentsFromItems(params.items),
      num_items: params.items.reduce((sum, i) => sum + i.quantity, 0),
      currency: CURRENCY,
      value: params.value,
    },
    params.eventId
  );
}
