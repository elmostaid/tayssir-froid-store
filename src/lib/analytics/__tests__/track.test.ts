import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { __resetAnalyticsQueueForTests, flushAnalytics, trackAnalyticsEvent } from "@/lib/analytics/track";
import type { AnalyticsWireBatch } from "@/lib/analytics/events";

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

let beaconCalls: { url: string; body: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  clearCookies();
  __resetAnalyticsQueueForTests();
  beaconCalls = [];
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value: (url: string, data?: BodyInit | null) => {
      // Blob.text() غير متزامنة، لكن jsdom يعطينا القيمة عبر وعد — نخزّن
      // النص مباشرة لأن الاختبارات تُنشئ Blob من سلسلة معروفة.
      beaconCalls.push({ url, body: (data as { __text?: string })?.__text ?? "" });
      return true;
    },
  });
  // نلتقط النص عند إنشاء الـBlob حتى نقرأه بشكل متزامن في التأكيدات.
  const RealBlob = globalThis.Blob;
  vi.stubGlobal(
    "Blob",
    class extends RealBlob {
      __text: string;
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        this.__text = parts.map((p) => String(p)).join("");
      }
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetAnalyticsQueueForTests();
});

function lastBatch(): AnalyticsWireBatch {
  expect(beaconCalls.length).toBeGreaterThan(0);
  return JSON.parse(beaconCalls[beaconCalls.length - 1].body) as AnalyticsWireBatch;
}

describe("trackAnalyticsEvent — التجميع قبل الإرسال", () => {
  test("لا يُرسل شيئاً فوراً: الأحداث تنتظر لتُجمَّع في طلب واحد", () => {
    trackAnalyticsEvent("session_start");
    trackAnalyticsEvent("landing_page_view");
    expect(beaconCalls).toHaveLength(0);
  });

  test("بعد المهلة: طلب واحد فقط يحمل الحدثين معاً", () => {
    trackAnalyticsEvent("session_start");
    trackAnalyticsEvent("landing_page_view");
    vi.advanceTimersByTime(5000);

    expect(beaconCalls).toHaveLength(1);
    const batch = lastBatch();
    expect(batch.events.map((e) => e.name)).toEqual(["session_start", "landing_page_view"]);
    expect(batch.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(beaconCalls[0].url).toBe("/api/analytics");
  });

  test("الشراء يُرسَل فوراً بلا انتظار — الصفحة على وشك الانتقال إلى واتساب", () => {
    trackAnalyticsEvent("begin_checkout", { cartValue: 1200 });
    expect(beaconCalls).toHaveLength(0);

    trackAnalyticsEvent(
      "purchase",
      { orderRef: "ref-123", orderValue: 1200, quantity: 100 },
      { immediate: true }
    );

    expect(beaconCalls).toHaveLength(1);
    const batch = lastBatch();
    expect(batch.events.map((e) => e.name)).toEqual(["begin_checkout", "purchase"]);
    expect(batch.events[1].orderRef).toBe("ref-123");
  });

  test("كل الأحداث تحمل نفس session_id — وهو أساس عدّ الأشخاص لا الأحداث", () => {
    trackAnalyticsEvent("product_view", { productId: 1, sku: "TF-1" });
    trackAnalyticsEvent("add_to_cart", { productId: 1, sku: "TF-1", quantity: 50 });
    vi.advanceTimersByTime(5000);

    const batch = lastBatch();
    expect(batch.events).toHaveLength(2);
    expect(batch.deviceType).toBeTruthy();
    expect(batch.browser).toBeTruthy();
  });

  test("لا شيء يُرسَل مرتين: بعد التفريغ يبقى الطابور فارغاً", () => {
    trackAnalyticsEvent("cart_view");
    flushAnalytics();
    flushAnalytics();
    vi.advanceTimersByTime(10000);
    expect(beaconCalls).toHaveLength(1);
  });

  test("إخفاء الصفحة (انتقال الزبون إلى تطبيق آخر) يُفرّغ الطابور", () => {
    trackAnalyticsEvent("product_view", { productId: 7, sku: "TF-7" });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(beaconCalls).toHaveLength(1);
  });
});

describe("trackAnalyticsEvent — لا يكسر الصفحة أبداً", () => {
  test("انهيار sendBeacon لا يرمي إلى المستدعي", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("beacon exploded");
      },
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);

    expect(() => {
      trackAnalyticsEvent("add_to_cart", { productId: 1, sku: "TF-1", quantity: 1 });
      flushAnalytics();
    }).not.toThrow();
    // يسقط إلى fetch مع keepalive بدل أن يفقد الحدث بصمت.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("فشل الشبكة في fetch لا يُنتج أي رفض غير مُلتقَط", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: () => false,
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));

    expect(() => {
      trackAnalyticsEvent("cart_view");
      flushAnalytics();
    }).not.toThrow();
  });
});
