import { afterEach, describe, expect, test, vi } from "vitest";
import {
  trackAddToCart,
  trackInitiateCheckout,
  trackPageView,
  trackPurchase,
  trackViewContent,
} from "@/lib/pixel/fbq";

function mockFbq() {
  const fn = vi.fn();
  window.fbq = fn;
  return fn;
}

function mockFetch() {
  const fn = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  delete (window as { fbq?: unknown }).fbq;
  vi.unstubAllGlobals();
});

describe("fbq.ts — طبقة نداء Meta Pixel الآمنة + إعادة توجيه CAPI", () => {
  test("لا يفعل شيئاً ولا يرمي خطأ إذا لم يُحمَّل fbq بعد (بلا window.fbq)", () => {
    mockFetch();
    expect(() =>
      trackViewContent({ sku: "TF-1", name: "منتج", price: 10 })
    ).not.toThrow();
  });

  test("trackPageView: يستدعي fbq('track','PageView', {}, {eventID}) ويُعيد توجيه نفس event_id إلى /api/pixel-events", () => {
    const fbq = mockFbq();
    const fetchMock = mockFetch();
    trackPageView();

    expect(fbq).toHaveBeenCalledTimes(1);
    const [event, name, params, options] = fbq.mock.calls[0];
    expect(event).toBe("track");
    expect(name).toBe("PageView");
    expect(params).toEqual({});
    expect(options.eventID).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pixel-events");
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body);
    expect(body.eventName).toBe("PageView");
    // نفس event_id بالضبط المُمرَّر لـfbq (شرط deduplication الصحيح).
    expect(body.eventId).toBe(options.eventID);
  });

  test("trackViewContent: content_type=product، currency=MAD، content_ids=[SKU]، value=السعر، ويُعاد توجيهها لـCAPI بنفس event_id", () => {
    const fbq = mockFbq();
    const fetchMock = mockFetch();
    trackViewContent({ sku: "TF-RF-001", name: "بودر نحاس", price: 20, category: "قطع غيار الثلاجات" });

    const [, , params, options] = fbq.mock.calls[0];
    expect(params).toEqual({
      content_ids: ["TF-RF-001"],
      content_name: "بودر نحاس",
      content_category: "قطع غيار الثلاجات",
      content_type: "product",
      currency: "MAD",
      value: 20,
    });
    expect(options.eventID).toBeTruthy();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.eventName).toBe("ViewContent");
    expect(body.eventId).toBe(options.eventID);
    expect(body.customData).toEqual(params);
  });

  test("trackAddToCart: value = السعر × الكمية، contents يحتوي item_price وquantity الصحيحين، ويُعاد توجيهها لـCAPI", () => {
    const fbq = mockFbq();
    const fetchMock = mockFetch();
    trackAddToCart({ sku: "TF-WM-004", name: "قطعة غسالة", price: 50, quantity: 3, category: "قطع غيار الغسالات" });

    const [, , params, options] = fbq.mock.calls[0];
    expect(params).toEqual({
      content_ids: ["TF-WM-004"],
      content_name: "قطعة غسالة",
      content_category: "قطع غيار الغسالات",
      content_type: "product",
      contents: [{ id: "TF-WM-004", quantity: 3, item_price: 50 }],
      currency: "MAD",
      value: 150,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.eventName).toBe("AddToCart");
    expect(body.eventId).toBe(options.eventID);
  });

  test("trackInitiateCheckout: content_ids = كل SKU فالسلة، value = المجموع، event_id يُمرَّر كـ{eventID} ويُعاد توجيهه لـCAPI", () => {
    const fbq = mockFbq();
    const fetchMock = mockFetch();
    trackInitiateCheckout({
      items: [
        { sku: "A", quantity: 2, price: 10 },
        { sku: "B", quantity: 1, price: 30 },
      ],
      value: 50,
      eventId: "evt-123",
    });

    expect(fbq).toHaveBeenCalledWith(
      "track",
      "InitiateCheckout",
      {
        content_ids: ["A", "B"],
        content_type: "product",
        contents: [
          { id: "A", quantity: 2, item_price: 10 },
          { id: "B", quantity: 1, item_price: 30 },
        ],
        num_items: 3,
        currency: "MAD",
        value: 50,
      },
      { eventID: "evt-123" }
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.eventName).toBe("InitiateCheckout");
    expect(body.eventId).toBe("evt-123");
  });

  test("trackInitiateCheckout بلا eventId مُمرَّر: يُولِّد واحداً تلقائياً، ونفسه فـfbq وCAPI", () => {
    const fbq = mockFbq();
    const fetchMock = mockFetch();
    trackInitiateCheckout({ items: [{ sku: "A", quantity: 1, price: 10 }], value: 10 });

    const generatedId = fbq.mock.calls[0][3].eventID;
    expect(generatedId).toBeTruthy();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.eventId).toBe(generatedId);
  });

  test("trackPurchase: نفس بنية InitiateCheckout + event_id إلزامي لتحضير deduplication مع Conversions API لاحقاً", () => {
    const fbq = mockFbq();
    mockFetch();
    trackPurchase({
      items: [{ sku: "TF-RF-001", quantity: 2, price: 20 }],
      value: 40,
      eventId: "order-idempotency-key-xyz",
    });

    expect(fbq).toHaveBeenCalledTimes(1);
    const [event, name, params, options] = fbq.mock.calls[0];
    expect(event).toBe("track");
    expect(name).toBe("Purchase");
    expect(params).toMatchObject({
      content_ids: ["TF-RF-001"],
      content_type: "product",
      currency: "MAD",
      value: 40,
      num_items: 2,
    });
    expect(options).toEqual({ eventID: "order-idempotency-key-xyz" });
  });

  test("trackPurchase بلا category/content_name (لا حقول إضافية غير مطلوبة فحدث Purchase)", () => {
    const fbq = mockFbq();
    mockFetch();
    trackPurchase({ items: [{ sku: "X", quantity: 1, price: 5 }], value: 5, eventId: "e1" });
    const params = fbq.mock.calls[0][2] as Record<string, unknown>;
    expect(params).not.toHaveProperty("content_name");
    expect(params).not.toHaveProperty("content_category");
  });

  test("trackPurchase لا يُعيد التوجيه إلى /api/pixel-events إطلاقاً — CAPI الخاص بـPurchase يُرسَل من الخادم مباشرة (createOrder.ts) لا من هنا", () => {
    mockFbq();
    const fetchMock = mockFetch();
    trackPurchase({ items: [{ sku: "X", quantity: 1, price: 5 }], value: 5, eventId: "order-key-1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
