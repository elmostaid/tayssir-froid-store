import { describe, expect, test } from "vitest";
import { buildTrustPoints } from "@/app/(storefront)/page";

describe("buildTrustPoints (نقاط الثقة الأربع فأعلى الصفحة الرئيسية)", () => {
  test("النص والترتيب مطابقان تماماً للمطلوب، والحد الأدنى يبقى ديناميكياً من settings", () => {
    const points = buildTrustPoints(1000);
    expect(points).toEqual([
      "الحد الأدنى للطلب: 1000 درهم",
      "الدفع عند الاستلام بعد معاينة السلعة",
      "التوصيل لجميع مدن المغرب 24–48 ساعة",
      "كلما زادت الكمية، كينقص الثمن",
    ]);
  });

  test("قيمة الحد الأدنى تتغيّر فعلياً مع settings.minOrderAmountMad (ليست نصاً ثابتاً)", () => {
    const points = buildTrustPoints(1500);
    expect(points[0]).toBe("الحد الأدنى للطلب: 1500 درهم");
  });
});
