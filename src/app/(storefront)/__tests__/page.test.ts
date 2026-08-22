import { describe, expect, test } from "vitest";
import { buildTrustPoints } from "@/app/(storefront)/page";

describe("buildTrustPoints (نقاط الثقة الأربع فأعلى الصفحة الرئيسية)", () => {
  test("لا أثر لأي حد أدنى — الوعد الأول صار حرية الطلب", () => {
    expect(buildTrustPoints()).toEqual([
      "اطلب أي كمية — بلا حد أدنى",
      "الدفع عند الاستلام بعد معاينة السلعة",
      "التوصيل لجميع مدن المغرب 24–48 ساعة",
      "كلما زادت الكمية، كينقص الثمن",
    ]);
  });

  test("لا يذكر أي مبلغ كحدّ أدنى", () => {
    expect(buildTrustPoints().join(" ")).not.toMatch(/الحد الأدنى للطلب/);
  });
});
