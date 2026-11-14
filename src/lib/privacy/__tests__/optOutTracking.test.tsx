import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextRequest } from "next/server";

/**
 * نمط «الرفض متاح» (NEXT_PUBLIC_AD_TRACKING_OPT_OUT=on): القياس يعمل لمن
 * لم يختر، والرفض الصريح نافذ في كل مسار. والقيمة المحفوظة لا تُزوَّر.
 */

const usePathnameMock = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => usePathnameMock() }));
const sendCapiEventMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));
vi.mock("@/lib/analytics/track", () => ({ trackAnalyticsEvent: vi.fn() }));

const consent = await import("@/lib/privacy/consent");
const { capiIdentityFromRequest } = await import("@/lib/pixel/identity");
const { attributionForConsent } = await import("@/lib/privacy/attribution");
const { metaPurchaseGate } = await import("@/lib/pixel/sendDeferredPurchase");
const { manualOrderConsent } = await import("@/lib/orders/originReference");
const { captureAttribution, getOrderAttribution } = await import("@/lib/attribution/capture");
const { PixelPageViewTracker } = await import("@/components/PixelPageViewTracker");
const { POST } = await import("@/app/api/pixel-events/route");

const touch = (fbclid: string | null) => ({
  utmSource: "fb", utmMedium: "paid", utmCampaign: "120252323359690742", utmContent: "120252323370090742",
  utmTerm: null, fbclid, gclid: null, ttclid: null, landingPath: "/washing-machines", referrerHost: null, at: Date.now(),
});
const ctx = (adConsent: "granted" | "denied" | "unknown") => ({
  adConsent, fbp: "fb.1.1.2", fbc: undefined, clientIpAddress: "1.2.3.4", clientUserAgent: "UA", eventSourceUrl: "https://www.tayssirfroid.com/checkout",
});

function clearConsentCookie() {
  document.cookie = "tf_ad_consent=; Max-Age=0; path=/";
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AD_TRACKING_OPT_OUT", "on");
  vi.stubEnv("NEXT_PUBLIC_AD_CONSENT_ENABLED", "");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  sendCapiEventMock.mockClear();
  clearConsentCookie();
  window.localStorage.clear();
  delete (window as { fbq?: unknown }).fbq;
});

describe("البوّابة: من يُقاس", () => {
  test("الرفض متاح: موافق ولم يختر ⇒ نعم، رفض صريح ⇒ لا، قيمة مزوّرة ⇒ كأنه لم يختر", () => {
    expect(consent.isAdTrackingAllowed("granted")).toBe(true);
    expect(consent.isAdTrackingAllowed("unknown")).toBe(true);
    expect(consent.isAdTrackingAllowed(undefined)).toBe(true);
    expect(consent.isAdTrackingAllowed("denied")).toBe(false);
    // الاختيار يُقرأ في هذا النمط حتى بلا NEXT_PUBLIC_AD_CONSENT_ENABLED، وإلا لما احتُرم الرفض
    expect(consent.adConsentFromCookie("denied")).toBe("denied");
  });

  test("بلا النمط: السلوك القديم حرفياً (موافقة صريحة وحدها)", () => {
    vi.stubEnv("NEXT_PUBLIC_AD_TRACKING_OPT_OUT", "");
    expect(consent.isAdTrackingAllowed("unknown")).toBe(false);
    expect(consent.isAdTrackingAllowed("granted")).toBe(true);
  });
});

describe("المتصفح", () => {
  test("زائر لم يختر: Pixel يُحمَّل وPageView يُطلَق", () => {
    clearConsentCookie();
    render(<PixelPageViewTracker pixelId="2565914390520172" />);
    const fbq = (window as unknown as { fbq?: { queue: unknown[][] } }).fbq;
    expect(fbq).toBeDefined();
    expect(fbq!.queue.map((call) => call.slice(0, 2))).toEqual([["init", "2565914390520172"], ["track", "PageView"]]);
  });

  test("رفض صريح سابق: لا Pixel إطلاقاً", () => {
    document.cookie = "tf_ad_consent=denied; path=/";
    render(<PixelPageViewTracker pixelId="2565914390520172" />);
    expect((window as { fbq?: unknown }).fbq).toBeUndefined();
  });

  test("fbclid يُحفظ مع إعلانه لمن لم يرفض، ولا يُحفظ لمن رفض", () => {
    window.history.replaceState(null, "", "/washing-machines?utm_source=fb&utm_content=120252323370090742&fbclid=IwAR-optout");
    captureAttribution();
    expect(getOrderAttribution()!.last!.fbclid).toBe("IwAR-optout");
    window.localStorage.clear();
    document.cookie = "tf_ad_consent=denied; path=/";
    captureAttribution();
    expect(getOrderAttribution()!.last!.fbclid).toBeNull();
    expect(getOrderAttribution()!.last!.utmContent).toBe("120252323370090742");
  });
});

describe("الخادم", () => {
  function relay(cookie: string) {
    return POST(
      new NextRequest("http://localhost:3000/api/pixel-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ eventName: "ViewContent", eventId: "evt-1", customData: {} }),
      })
    );
  }

  test("CAPI relay: لم يختر ⇒ يُرسَل بنفس event_id، رفض ⇒ 204 ولا شيء", async () => {
    await relay("_fbp=fb.1.1.2");
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
    expect((sendCapiEventMock.mock.calls[0] as unknown[])[0]).toMatchObject({ eventName: "ViewContent", eventId: "evt-1" });
    sendCapiEventMock.mockClear();
    const refused = await relay("_fbp=fb.1.1.2; tf_ad_consent=denied");
    expect(refused.status).toBe(204);
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("هوية المطابقة ومعرّف النقرة مع الطلبية: لمن لم يرفض فقط", () => {
    expect(capiIdentityFromRequest(ctx("unknown"), touch("IwAR-x"))).toMatchObject({ fbp: "fb.1.1.2", fbclid: "IwAR-x", clientIpAddress: "1.2.3.4" });
    expect(capiIdentityFromRequest(ctx("denied"), touch("IwAR-x"))).toBeNull();
    const attribution = { first: touch("IwAR-x"), last: touch("IwAR-x") };
    expect(attributionForConsent(attribution, "unknown")!.last!.fbclid).toBe("IwAR-x");
    expect(attributionForConsent(attribution, "denied")!.last!.fbclid).toBeNull();
  });

  test("Purchase: لم يختر ⇒ بهوية كاملة (لا بيانات دنيا)، رفض ⇒ لا يُرسَل", () => {
    const now = Date.now();
    const base = { source: "website", confirmed_at: new Date(now - 60_000), created_at: new Date(now - 120_000) };
    expect(metaPurchaseGate({ ...base, ad_consent: "unknown" }, now)).toEqual({ ok: true, actionSource: "website", minimal: false });
    expect(metaPurchaseGate({ ...base, ad_consent: "denied" }, now)).toEqual({ ok: false, reason: "no_consent" });
  });

  test("طلبية واتساب يدوية: هوية استفسار الموقع تُنسخ لمن لم يرفض، والاختيار المحفوظ يبقى الحقيقي", () => {
    const origin = (adConsent: "unknown" | "denied") =>
      ({ reference: "Q-1A2B3C4D5E", attributionFirst: null, attributionLast: null, capiIdentity: null, adConsent }) as never;
    expect(manualOrderConsent(origin("unknown"), false)).toEqual({ adConsent: "unknown", source: "inherited", copyIdentity: true });
    expect(manualOrderConsent(origin("denied"), false)).toEqual({ adConsent: "denied", source: "inherited", copyIdentity: false });
    expect(manualOrderConsent(null, false)).toEqual({ adConsent: "unknown", source: null, copyIdentity: false });
  });
});
