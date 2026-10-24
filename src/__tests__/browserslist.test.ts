import { describe, expect, test } from "vitest";
import browserslist from "browserslist";

// حارس ضد فقدان .browserslistrc عن طريق الخطأ مستقبلاً (حذف، إعادة تسمية،
// تعديل الاستعلامات بشكل يُضيّق النطاق بصمت) — بدونه، Lightning CSS
// (المحرّك الداخلي لـ@tailwindcss/postcss v4) يعود لهدف حديث افتراضياً
// (Safari 16.4+/Chrome 111+ تقريباً)، وهو بالضبط السبب الجذري الذي أدى إلى
// عدم تطبيق بعض قواعد CSS (مثل بادئة -webkit- لخاصيتَي text-decoration-line
// وposition:sticky) على متصفحات أقدم حقيقية لدى الزبائن.
describe("إعداد .browserslistrc (توافق CSS مع المتصفحات الأقدم)", () => {
  test("النطاق المُحلَّل يشمل فعلياً iOS Safari قديماً (>= 11) وليس فقط أحدث إصدار", () => {
    const targets = browserslist();
    const iosSafariVersions = targets
      .filter((t) => t.startsWith("ios_saf "))
      .map((t) => parseFloat(t.split(" ")[1]));

    expect(iosSafariVersions.length).toBeGreaterThan(0);
    expect(Math.min(...iosSafariVersions)).toBeLessThanOrEqual(11);
  });

  test("النطاق يشمل Firefox ESR وAndroid، وليس Chrome/Safari الحديث فقط", () => {
    const targets = browserslist();
    expect(targets.some((t) => t.startsWith("firefox "))).toBe(true);
    expect(targets.some((t) => t.startsWith("android "))).toBe(true);
  });
});
