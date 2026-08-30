import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { sanitizeAttribution, sanitizeTouch, describeTouch, MAX_ATTRIBUTION_VALUE_LENGTH } from "@/lib/attribution/types";
import { captureAttribution, getOrderAttribution, readTouchFromLocation } from "@/lib/attribution/capture";

function visit(search: string, referrer = "", pathname = "/") {
  const url = new URL(`https://www.tayssirfroid.com${pathname}${search}`);
  Object.defineProperty(window, "location", {
    value: { search: url.search, pathname: url.pathname, hostname: url.hostname, protocol: "https:" },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  visit("");
});
afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("sanitize — الخادم لا يثق بما يرسله المتصفح", () => {
  test("يُسقط الحقول المجهولة ويقصّ النصوص الطويلة", () => {
    const touch = sanitizeTouch({
      utmSource: "  facebook  ",
      utmCampaign: "x".repeat(MAX_ATTRIBUTION_VALUE_LENGTH + 50),
      evil: "drop table orders",
      at: 123,
    });
    expect(touch).not.toBeNull();
    expect(touch!.utmSource).toBe("facebook");
    expect(touch!.utmCampaign).toHaveLength(MAX_ATTRIBUTION_VALUE_LENGTH);
    expect((touch as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(touch!.at).toBe(123);
  });

  test("لمسة بلا أي معلومة مصدر تُرفض", () => {
    expect(sanitizeTouch({ at: 1 })).toBeNull();
    expect(sanitizeTouch({ utmSource: "   " })).toBeNull();
    expect(sanitizeTouch(null)).toBeNull();
    expect(sanitizeTouch("nope")).toBeNull();
  });

  test("حمولة فارغة أو غير صالحة تُرجع null بلا استثناء", () => {
    expect(sanitizeAttribution(null)).toBeNull();
    expect(sanitizeAttribution({})).toBeNull();
    expect(sanitizeAttribution({ first: {}, last: {} })).toBeNull();
    expect(sanitizeAttribution("[]")).toBeNull();
  });

  test("at غير رقمي يُستبدل بالوقت الحالي بدل رفض اللمسة", () => {
    const touch = sanitizeTouch({ utmSource: "fb", at: "hier" });
    expect(touch!.at).toBeTypeOf("number");
  });
});

describe("readTouchFromLocation — التمييز بين مصدر جديد وتنقّل داخلي", () => {
  test("رابط بوسوم حملة = لمسة", () => {
    visit("?utm_source=facebook&utm_campaign=tf_sales_v2&utm_content=reel_23aug");
    const touch = readTouchFromLocation();
    expect(touch).toMatchObject({
      utmSource: "facebook", utmCampaign: "tf_sales_v2", utmContent: "reel_23aug",
    });
  });

  test("fbclid وحده = لمسة", () => {
    visit("?fbclid=ABC123");
    expect(readTouchFromLocation()?.fbclid).toBe("ABC123");
  });

  test("إحالة خارجية بلا وسوم = لمسة", () => {
    visit("", "https://m.facebook.com/");
    expect(readTouchFromLocation()?.referrerHost).toBe("m.facebook.com");
  });

  test("تنقّل داخلي = ليس لمسة", () => {
    visit("", "https://www.tayssirfroid.com/", "/product/x");
    expect(readTouchFromLocation()).toBeNull();
  });

  test("زيارة مباشرة: ليست لمسة إلا حين نطلبها صراحةً لأول لمسة", () => {
    visit("");
    expect(readTouchFromLocation(false)).toBeNull();
    expect(readTouchFromLocation(true)).not.toBeNull();
  });
});

describe("captureAttribution — first ثابتة وlast تتبع المصدر الجديد", () => {
  test("أول زيارة بحملة: first وlast متطابقتان", () => {
    visit("?utm_source=facebook&utm_campaign=c1");
    captureAttribution();
    const attr = getOrderAttribution()!;
    expect(attr.first!.utmCampaign).toBe("c1");
    expect(attr.last!.utmCampaign).toBe("c1");
  });

  test("التنقّل داخل الموقع لا يمحو الحملة — جوهر المطلوب", () => {
    visit("?utm_source=facebook&utm_campaign=c1");
    captureAttribution();
    // الزبون يتنقّل بين خمس صفحات داخلية
    for (const path of ["/product/a", "/cart", "/product/b", "/checkout", "/"]) {
      visit("", "https://www.tayssirfroid.com/", path);
      captureAttribution();
    }
    const attr = getOrderAttribution()!;
    expect(attr.first!.utmCampaign).toBe("c1");
    expect(attr.last!.utmCampaign).toBe("c1");
  });

  test("عودة من حملة ثانية: first تبقى الأولى وlast تصبح الثانية", () => {
    visit("?utm_source=facebook&utm_campaign=c1");
    captureAttribution();
    visit("?utm_source=google&utm_campaign=c2", "https://www.google.com/");
    captureAttribution();
    const attr = getOrderAttribution()!;
    expect(attr.first!.utmCampaign).toBe("c1");
    expect(attr.first!.utmSource).toBe("facebook");
    expect(attr.last!.utmCampaign).toBe("c2");
    expect(attr.last!.utmSource).toBe("google");
  });

  test("زائر مباشر تماماً: تُسجَّل أول لمسة «مباشر» بلا اختراع مصدر", () => {
    visit("");
    captureAttribution();
    const attr = getOrderAttribution()!;
    expect(attr.first).not.toBeNull();
    expect(attr.first!.utmSource).toBeNull();
    expect(attr.first!.referrerHost).toBeNull();
    expect(describeTouch(attr.first)).toBe("مباشر");
  });

  test("أول لمسة أقدم من 90 يوماً تُعاد تأسيسها", () => {
    visit("?utm_source=facebook&utm_campaign=old");
    captureAttribution();
    const stale = JSON.parse(window.localStorage.getItem("tf_attr_first")!);
    stale.at = Date.now() - 91 * 86_400_000;
    window.localStorage.setItem("tf_attr_first", JSON.stringify(stale));

    visit("?utm_source=google&utm_campaign=new", "https://www.google.com/");
    captureAttribution();
    expect(getOrderAttribution()!.first!.utmCampaign).toBe("new");
  });

  test("بلا أي التقاط: getOrderAttribution تُرجع null ولا ترمي", () => {
    expect(getOrderAttribution()).toBeNull();
  });

  test("تخزين محظور لا يرمي استثناءً ولا يعطّل شيئاً", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    visit("?utm_source=facebook");
    expect(() => captureAttribution()).not.toThrow();
    spy.mockRestore();
  });
});

describe("describeTouch — وصف مقروء للوحة الإدارة", () => {
  test("يفضّل utm_source ثم مُعرّف النقر ثم الإحالة", () => {
    expect(describeTouch(sanitizeTouch({ utmSource: "facebook", utmMedium: "cpc" }))).toBe("facebook / cpc");
    expect(describeTouch(sanitizeTouch({ fbclid: "x" }))).toBe("facebook (fbclid)");
    expect(describeTouch(sanitizeTouch({ gclid: "x" }))).toBe("google (gclid)");
    expect(describeTouch(sanitizeTouch({ referrerHost: "m.facebook.com" }))).toBe("m.facebook.com");
    expect(describeTouch(null)).toBe("غير معروف");
  });
});
