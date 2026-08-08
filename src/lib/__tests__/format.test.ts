import { describe, expect, test } from "vitest";
import { formatMad, formatMinOrderAmount } from "@/lib/format";

describe("formatMad", () => {
  test("يعرض الرقم كنص مع كلمة درهم وخانتين عشريتين", () => {
    expect(formatMad(1000)).toContain("درهم");
    expect(formatMad(1000)).toContain("1.000,00");
  });

  test("يقبل القيمة كنص (كما ترجع من قاعدة البيانات) ويحولها بشكل صحيح", () => {
    expect(formatMad("18.00")).toBe("18,00 درهم");
  });

  test("يقرب المنازل العشرية إلى خانتين", () => {
    expect(formatMad(120)).toBe("120,00 درهم");
  });
});

describe("formatMinOrderAmount", () => {
  test("يعرض رقماً صحيحاً بلا فواصل عشرية ولا فواصل آلاف", () => {
    expect(formatMinOrderAmount(1000)).toBe("1000 درهم");
  });

  test("يقرّب أي قيمة غير صحيحة إلى أقرب رقم صحيح", () => {
    expect(formatMinOrderAmount(1000.4)).toBe("1000 درهم");
    expect(formatMinOrderAmount(999.6)).toBe("1000 درهم");
  });
});
