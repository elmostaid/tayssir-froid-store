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

export type PixelContentItem = {
  sku: string;
  quantity: number;
  price: number;
};

function callFbq(eventName: string, params: Record<string, unknown>, eventId?: string): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  if (eventId) {
    window.fbq("track", eventName, params, { eventID: eventId });
  } else {
    window.fbq("track", eventName, params);
  }
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
  callFbq("PageView", {});
}

export function trackViewContent(params: {
  sku: string;
  name: string;
  price: number;
  category?: string | null;
}): void {
  callFbq("ViewContent", {
    content_ids: [params.sku],
    content_name: params.name,
    content_category: params.category ?? undefined,
    content_type: CONTENT_TYPE,
    currency: CURRENCY,
    value: params.price,
  });
}

export function trackAddToCart(params: {
  sku: string;
  name: string;
  price: number;
  quantity: number;
  category?: string | null;
}): void {
  callFbq("AddToCart", {
    content_ids: [params.sku],
    content_name: params.name,
    content_category: params.category ?? undefined,
    content_type: CONTENT_TYPE,
    contents: contentsFromItems([{ sku: params.sku, quantity: params.quantity, price: params.price }]),
    currency: CURRENCY,
    value: params.price * params.quantity,
  });
}

export function trackInitiateCheckout(params: {
  items: PixelContentItem[];
  value: number;
  eventId?: string;
}): void {
  callFbq(
    "InitiateCheckout",
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

/**
 * event_id هنا هو idempotencyKey نفسه المُستعمَل لضمان عدم تكرار الطلب فـ
 * createOrder — نفس القيمة بالضبط ستُستعمَل لاحقاً كـevent_id لنفس الحدث
 * عبر Conversions API (CAPI) من جهة الخادم، ليقدر Meta على "deduplication"
 * (اعتبار حدث Pixel وحدث CAPI لنفس عملية الشراء حدثاً واحداً، لا حدثين).
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
