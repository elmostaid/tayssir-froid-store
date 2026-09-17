import { describe, expect, test } from "vitest";
import { buildTrustPoints } from "@/app/(storefront)/page";
import { DELIVERY_AVAILABILITY } from "@/lib/delivery";

describe("buildTrustPoints (نقاط الثقة الأربع فأعلى الصفحة الرئيسية)", () => {
  // النقاط صارت ثابتة: سطر التوصيل لم يعد مشتقّاً من رقم الرسوم، لأن
  // السياسة نفسها لم تعد ثنائية (مجاني/بثمن) بل واحدة — توفّرٌ ومصاريف
  // تُحدَّد عند التأكيد.
  test("النقاط الأربع كما يراها الزائر", () => {
    expect(buildTrustPoints()).toEqual([
      "أثمنة مناسبة للتجار والحرفيين",
      "الدفع عند الاستلام بعد معاينة السلعة",
      `🚚 ${DELIVERY_AVAILABILITY}`,
      "تخفيضات خاصة للكميات الكبيرة",
    ]);
  });

  // الوعد الذي أُلغي: لا يعود من أي باب.
  test("لا وعد بمجانية التوصيل ولا ذكر لثمنه", () => {
    const text = buildTrustPoints().join(" ");
    expect(text).not.toMatch(/مجان|بالمجان|free\s*shipping|gratuit/i);
    expect(text).not.toMatch(/\d[\d.,]*\s*(درهم|MAD)/i);
  });

  // الذيل الذي كان يُطيل أول سطر حتى يلتفّ سطرين على الهاتف.
  test("لا شرح للكمية الدنيا في الهيرو", () => {
    const text = buildTrustPoints().join(" ");
    expect(text).not.toContain("الكمية الدنيا");
    expect(text).not.toContain("حسب المنتوج");
  });

  // أربع نقاط قصيرة: الهيرو يُقاس بما يُخفيه من المنتجات تحته.
  test("أربع نقاط فقط، وكل واحدة قصيرة تكفي سطراً واحداً", () => {
    const points = buildTrustPoints();
    expect(points).toHaveLength(4);
    for (const point of points) {
      expect(point.length).toBeLessThanOrEqual(40);
    }
  });

  // الحاجز أُلغي نهائياً، فأي مبلغ يظهر هنا كشرط شراء يكون كذباً على
  // الزبون ويعيد إليه بالضبط التردّد الذي ألغينا الحاجز لأجله.
  test("لا يذكر أي شرط مالي عام", () => {
    const text = buildTrustPoints().join(" ");
    expect(text).not.toMatch(/الحد الأدنى للطلب|أقل طلب|أقل قيمة/);
  });

  // «بلا حد أدنى» وعدٌ مطلق تكذّبه الكمية الدنيا لكل منتج.
  test("لا يعد الزبون بحرية مطلقة في الكمية", () => {
    expect(buildTrustPoints().join(" ")).not.toMatch(/بلا حد أدنى|أي كمية/);
  });
});
