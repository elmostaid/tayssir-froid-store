import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sendGaPurchaseEvent, isGaMeasurementProtocolConfigured } from "@/lib/ga/measurementProtocol";
import { gaClientIdFromCookie, gaSessionIdFromCookie } from "@/lib/orders/requestContext";

/**
 * مسار GA4 من الخادم. ما يهمّ إثباته هنا ثلاثة أشياء لا رابعَ لها:
 * لا يُرسل بلا تهيئة كاملة، ويُعيد المحاولة مرة على عطل عابر لا على رفض
 * منطقي، ولا يرمي أبداً مهما فعل الطرف الآخر.
 */

const ORIGINAL_SECRET = process.env.GA4_API_SECRET;

const BASE = {
  transactionId: "TF-REF-TEST",
  value: 300,
  items: [{ item_id: "TF-01", item_name: "قطعة", price: 100, quantity: 3 }],
  clientId: "1234567890.1700000000",
  sessionId: "1756000000",
};

beforeEach(() => {
  process.env.GA4_API_SECRET = "test-secret";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.GA4_API_SECRET;
  else process.env.GA4_API_SECRET = ORIGINAL_SECRET;
  vi.unstubAllGlobals();
});

describe("قراءة كوكيّات GA4", () => {
  test("_ga: المقطعان الأخيران هما client_id", () => {
    expect(gaClientIdFromCookie("GA1.1.1234567890.1700000000")).toBe("1234567890.1700000000");
    expect(gaClientIdFromCookie("GA1.2.987.654")).toBe("987.654");
  });

  test("شكل غير معروف يُرجع null بدل مُعرّف مخترَع", () => {
    expect(gaClientIdFromCookie(undefined)).toBeNull();
    expect(gaClientIdFromCookie("")).toBeNull();
    expect(gaClientIdFromCookie("GA1.1.abc")).toBeNull();
    expect(gaClientIdFromCookie("GA1.1.abc.def")).toBeNull();
  });

  test("_ga_<container>: المقطع الثالث هو session_id", () => {
    expect(gaSessionIdFromCookie("GS1.1.1756000000.1.1.1756000123.0.0.0")).toBe("1756000000");
    expect(gaSessionIdFromCookie("GS1.1.x.1")).toBeNull();
    expect(gaSessionIdFromCookie(undefined)).toBeNull();
  });
});

describe("متى يُرسِل الخادم ومتى يمتنع", () => {
  test("بلا GA4_API_SECRET: لا تهيئة ولا إرسال ولا نداء شبكة إطلاقاً", async () => {
    delete process.env.GA4_API_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(isGaMeasurementProtocolConfigured()).toBe(false);
    expect(await sendGaPurchaseEvent(BASE)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("بلا client_id: لا إرسال — جلسة GA4 مخترعة أسوأ من لا شيء", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendGaPurchaseEvent({ ...BASE, clientId: undefined })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("الحمولة تحمل transaction_id وMAD وsession_id", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendGaPurchaseEvent(BASE)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("measurement_id=G-SEJZVX93W4");
    expect(url).toContain("api_secret=test-secret");

    const body = JSON.parse(String(init.body));
    expect(body.client_id).toBe("1234567890.1700000000");
    expect(body.events[0].name).toBe("purchase");
    expect(body.events[0].params).toMatchObject({
      transaction_id: "TF-REF-TEST",
      currency: "MAD",
      value: 300,
      session_id: "1756000000",
    });
    expect(body.events[0].params.items).toHaveLength(1);
  });
});

describe("الصمود أمام الشبكة", () => {
  test("عطل عابر ثم نجاح: محاولتان ونتيجة صحيحة", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("شبكة مقطوعة");
      return { ok: true, status: 204 } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendGaPurchaseEvent(BASE)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("رفض 4xx: لا إعادة محاولة — سرّ أو حمولة خاطئة لن يُصلحها التكرار", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendGaPurchaseEvent(BASE)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("عطل مستمر: يعود false بلا أن يرمي أبداً", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("انقطاع دائم");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendGaPurchaseEvent(BASE)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
