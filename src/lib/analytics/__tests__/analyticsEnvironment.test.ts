import { describe, expect, test } from "vitest";
import { GA_MEASUREMENT_ID, isAnalyticsEnabled } from "@/lib/analytics/config";

describe("GA4 لا يعمل إلا في الإنتاج", () => {
  test("نشر إنتاجي على Vercel ⇒ يعمل", () => {
    expect(isAnalyticsEnabled({ VERCEL_ENV: "production" })).toBe(true);
  });

  test("معاينة ⇒ لا يعمل، فلا تُلوَّث أرقام القرار التجاري", () => {
    expect(isAnalyticsEnabled({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isAnalyticsEnabled({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
  });

  test("تطوير على Vercel ⇒ لا يعمل", () => {
    expect(isAnalyticsEnabled({ VERCEL_ENV: "development" })).toBe(false);
  });

  test("بلا Vercel إطلاقاً: NODE_ENV وحدها تحكم", () => {
    expect(isAnalyticsEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(isAnalyticsEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isAnalyticsEnabled({})).toBe(false);
  });

  test("المعرّف نفسه لم يتغيّر — الحارس يمنع الإرسال، لا يُبدِّل الخاصية", () => {
    expect(GA_MEASUREMENT_ID).toBe("G-SEJZVX93W4");
  });
});
