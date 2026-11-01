import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseAdConsent, writeAdConsent } from "@/lib/privacy/consent";
import {
  inquiryReferenceFromKey,
  parseOriginReference,
  withInquiryReference,
} from "@/lib/whatsappInquiry";
import { captureAttribution, getOrderAttribution } from "@/lib/attribution/capture";
import { WhatsAppInquiryLink } from "@/components/WhatsAppInquiryLink";
import { ConsentBanner } from "@/components/ConsentBanner";

vi.mock("@/lib/analytics/track", () => ({ trackAnalyticsEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = "tf_ad_consent=; Max-Age=0; path=/";
  window.localStorage.clear();
});

describe("الموافقة: الصمت ليس موافقة", () => {
  test.each([
    ["granted", "granted"],
    ["denied", "denied"],
    [undefined, "unknown"],
    ["yes", "unknown"],
    ["GRANTED", "unknown"],
  ])("%s ⇒ %s", (raw, expected) => {
    expect(parseAdConsent(raw)).toBe(expected);
  });
});

describe("مرجع الاستفسار Q-", () => {
  test("حتمي من المفتاح، عشر خانات كبيرة", () => {
    const key = "1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab";
    expect(inquiryReferenceFromKey(key)).toBe("Q-1A2B3C4D5E");
    expect(inquiryReferenceFromKey(key)).toBe(inquiryReferenceFromKey(key));
  });

  test("مفتاح غير صالح ⇒ لا مرجع", () => {
    expect(inquiryReferenceFromKey("abc")).toBeNull();
    expect(inquiryReferenceFromKey("")).toBeNull();
  });

  test("المدير يلصق الرسالة كاملة أو المرجع بحروف صغيرة — يُستخرج بالضبط", () => {
    const message = withInquiryReference("مرحباً، عندي سؤال", "Q-1A2B3C4D5E");
    expect(parseOriginReference(message)).toBe("Q-1A2B3C4D5E");
    expect(parseOriginReference("  q-1a2b3c4d5e ")).toBe("Q-1A2B3C4D5E");
    expect(parseOriginReference("المرجع: W-ABCDEF12")).toBe("W-ABCDEF12");
    expect(parseOriginReference("Q-123")).toBeNull();
    expect(parseOriginReference("W-ABCDEF1234")).toBeNull();
  });
});

describe("WhatsAppInquiryLink", () => {
  function renderLink() {
    render(
      <WhatsAppInquiryLink whatsappNumber="0722083458" message="سؤال" kind="product" productSku="TF-1">
        استفسار
      </WhatsAppInquiryLink>
    );
    return screen.getByRole("link", { name: "استفسار" }) as HTMLAnchorElement;
  }

  test("قبل الضغط: الرسالة كما هي (تعمل بلا JavaScript)، وبلا مرجع", () => {
    const link = renderLink();
    const text = new URL(link.href).searchParams.get("text");
    expect(text).toBe("سؤال");
    expect(link.target).toBe("_blank");
  });

  test("الضغط: المرجع في الرسالة نفسها، والاستفسار يُسجَّل بـkeepalive بنفس المفتاح", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const link = renderLink();

    fireEvent.click(link);
    const text = new URL(link.href).searchParams.get("text") ?? "";
    const reference = parseOriginReference(text);
    expect(reference).toMatch(/^Q-[0-9A-F]{10}$/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/whatsapp-inquiries");
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body);
    expect(inquiryReferenceFromKey(body.idempotencyKey)).toBe(reference);
    expect(body).toMatchObject({ kind: "product", productSku: "TF-1" });

    // ضغطة ثانية: نفس المرجع ونفس المفتاح — استفسار واحد على الخادم.
    fireEvent.click(link);
    expect(parseOriginReference(new URL(link.href).searchParams.get("text") ?? "")).toBe(reference);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).idempotencyKey).toBe(body.idempotencyKey);
  });
});

describe("WhatsAppInquiryLink: عطب التسجيل لا يمنع التواصل أبداً", () => {
  function linkFor(onClick?: () => void) {
    render(
      <WhatsAppInquiryLink whatsappNumber="0722083458" message="سؤال" kind="general" onClick={onClick}>
        استفسار
      </WhatsAppInquiryLink>
    );
    return screen.getByRole("link", { name: "استفسار" }) as HTMLAnchorElement;
  }

  test.each([
    ["الخادم يرفض (500)", () => vi.fn().mockResolvedValue({ ok: false, status: 500 })],
    ["الشبكة مقطوعة", () => vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))],
    ["fetch يرمي فوراً (keepalive غير مدعوم)", () => vi.fn(() => { throw new TypeError("keepalive"); })],
  ])("%s: الضغطة لا تُلغى، والرابط واتساب صالح", (_label, makeFetch) => {
    vi.stubGlobal("fetch", makeFetch());
    const link = linkFor();
    const notCancelled = fireEvent.click(link);
    expect(notCancelled).toBe(true);
    expect(link.href.startsWith("https://api.whatsapp.com/send/?")).toBe(true);
  });

  test("حتى لو رمى onClick المُمرَّر نفسه: الضغطة لا تُلغى والرسالة الأصلية تبقى", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const link = linkFor(() => {
      throw new Error("boom");
    });
    expect(fireEvent.click(link)).toBe(true);
    expect(new URL(link.href).searchParams.get("text")).toBe("سؤال");
  });

  test("بلا مصدر عشوائية (crypto غائب): لا مرجع، والرابط الأصلي يعمل", () => {
    vi.stubGlobal("crypto", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const link = linkFor();
    expect(fireEvent.click(link)).toBe(true);
    expect(new URL(link.href).searchParams.get("text")).toBe("سؤال");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("معرّف النقرة لا يُكتب على الجهاز قبل الموافقة", () => {
  function landFromAd() {
    window.history.replaceState(null, "", "/water-heaters?utm_source=facebook&fbclid=IwAR-landing");
    captureAttribution();
  }

  test("بلا موافقة: الحملة تُحفظ، والمعرّف لا", () => {
    landFromAd();
    const stored = getOrderAttribution();
    expect(stored?.last?.utmSource).toBe("facebook");
    expect(stored?.last?.fbclid).toBeNull();
    expect(window.localStorage.getItem("tf_attr_last")).not.toContain("IwAR-landing");
  });

  test("يوافق في نفس الصفحة: المعرّف المنتظر يُكتب في لمسته", () => {
    landFromAd();
    writeAdConsent("granted");
    expect(getOrderAttribution()?.last?.fbclid).toBe("IwAR-landing");
    expect(getOrderAttribution()?.first?.fbclid).toBe("IwAR-landing");
  });

  test("يسحب موافقته لاحقاً: المعرّف يُمحى من الجهاز", () => {
    writeAdConsent("granted");
    landFromAd();
    expect(getOrderAttribution()?.last?.fbclid).toBe("IwAR-landing");
    writeAdConsent("denied");
    expect(getOrderAttribution()?.last?.fbclid).toBeNull();
  });
});

describe("شريط الموافقة: القبول والرفض بنفس السهولة", () => {
  test("الزرّان بنفس المظهر حرفياً، وكلاهما يحفظ الاختيار ويُخفي الشريط", () => {
    for (const [label, expected] of [["موافق", "granted"], ["رفض", "denied"]] as const) {
      document.cookie = "tf_ad_consent=; Max-Age=0; path=/";
      render(<ConsentBanner />);
      const accept = screen.getByRole("button", { name: "موافق" });
      const refuse = screen.getByRole("button", { name: "رفض" });
      expect(accept.className).toBe(refuse.className);
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(document.cookie).toContain(`tf_ad_consent=${expected}`);
      expect(screen.queryByRole("dialog")).toBeNull();
      cleanup();
    }
  });
});
