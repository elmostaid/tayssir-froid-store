import { describe, test, expect } from "vitest";
import { sanitizeAttribution } from "@/lib/attribution/types";

/**
 * حراسة السلسلة: ما يرسله المتصفح ← ما يُنقّى ← ما يُخزَّن.
 *
 * الاختبار على المُنقّي نفسه لا على قاعدة البيانات: هو الحدّ الوحيد الذي
 * يفصل مدخلاً غير موثوق عن عمود jsonb، فسلامته هي المهمة.
 */
describe("سلسلة النسب من المتصفح إلى الطلب", () => {
  test("حمولة حملة كاملة تمرّ كما هي", () => {
    const attr = sanitizeAttribution({
      first: {
        utmSource: "facebook", utmMedium: "cpc", utmCampaign: "tf_sales_v2",
        utmContent: "reel_23aug", utmTerm: null, fbclid: "IwAR123",
        gclid: null, ttclid: null, landingPath: "/product/x",
        referrerHost: "m.facebook.com", at: 1756500000000,
      },
      last: {
        utmSource: "google", utmCampaign: "search_brand",
        gclid: "Cj0KCQ", landingPath: "/", at: 1756600000000,
      },
    })!;

    expect(attr.first).toMatchObject({
      utmSource: "facebook", utmCampaign: "tf_sales_v2",
      utmContent: "reel_23aug", fbclid: "IwAR123", referrerHost: "m.facebook.com",
    });
    expect(attr.last).toMatchObject({ utmSource: "google", gclid: "Cj0KCQ" });
  });

  test("طلب واتساب (بلا نسب) يُخزَّن NULL لا قيمة مخترَعة", () => {
    expect(sanitizeAttribution(undefined)).toBeNull();
    expect(sanitizeAttribution({ first: null, last: null })).toBeNull();
  });

  test("حمولة عدائية: حقول مجهولة تُسقَط ولا شيء يُنفَّذ", () => {
    const attr = sanitizeAttribution({
      first: {
        utmSource: "facebook",
        __proto__: { polluted: true },
        constructor: "x",
        nested: { deep: { evil: true } },
        at: 1,
      },
      last: null,
    })!;
    const keys = Object.keys(attr.first!).sort();
    expect(keys).toEqual([
      "at", "fbclid", "gclid", "landingPath", "referrerHost", "ttclid",
      "utmCampaign", "utmContent", "utmMedium", "utmSource", "utmTerm",
    ]);
    expect((attr.first as unknown as Record<string, unknown>).nested).toBeUndefined();
  });

  test("first وحدها كافية — last قد تكون null", () => {
    const attr = sanitizeAttribution({ first: { utmSource: "facebook", at: 1 }, last: null })!;
    expect(attr.first).not.toBeNull();
    expect(attr.last).toBeNull();
  });
});
