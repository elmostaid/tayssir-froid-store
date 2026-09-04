import { describe, expect, test } from "vitest";
import { buildTrustPoints } from "@/app/(storefront)/page";

describe("buildTrustPoints (نقاط الثقة الأربع فأعلى الصفحة الرئيسية)", () => {
  test("الوعد الأول صار سعراً مناسباً للتاجر، لا حدّاً أدنى", () => {
    // برسوم توصيل قائمة (30): سطر التوصيل وحده يعود لصيغته المدفوعة.
    expect(buildTrustPoints(30)).toEqual([
      "أثمنة مناسبة للتجار والحرفيين",
      "الدفع عند الاستلام بعد معاينة السلعة",
      "التوصيل لجميع مناطق المغرب 24–48 ساعة",
      "تخفيضات خاصة للكميات الكبيرة",
    ]);
  });

  // الإعداد وحده يقرّر الجملة: صفر ⇒ «بالمجان»، ورقمٌ موجب ⇒ الجملة
  // القديمة. هذا ما يجعل التراجع عن مجانية التوصيل تعديلَ رقم في
  // /admin/settings لا تعديلَ كود.
  test("التوصيل المجاني يُعلَن حين تكون الرسوم صفراً", () => {
    const free = buildTrustPoints(0).join(" ");
    expect(free).toContain("🚚 التوصيل بالمجان لجميع مناطق المغرب");
    expect(buildTrustPoints(30).join(" ")).not.toContain("بالمجان");
  });

  // الذيل الذي كان يُطيل أول سطر حتى يلتفّ سطرين على الهاتف.
  test("لا شرح للكمية الدنيا في الهيرو", () => {
    for (const fee of [0, 30]) {
      const text = buildTrustPoints(fee).join(" ");
      expect(text).not.toContain("الكمية الدنيا");
      expect(text).not.toContain("حسب المنتوج");
    }
  });

  // أربع نقاط قصيرة: الهيرو يُقاس بما يُخفيه من المنتجات تحته.
  test("أربع نقاط فقط، وكل واحدة قصيرة تكفي سطراً واحداً", () => {
    const points = buildTrustPoints(0);
    expect(points).toHaveLength(4);
    for (const point of points) {
      expect(point.length).toBeLessThanOrEqual(40);
    }
  });

  // الحاجز أُلغي نهائياً، فأي مبلغ يظهر هنا كشرط شراء يكون كذباً على
  // الزبون ويعيد إليه بالضبط التردّد الذي ألغينا الحاجز لأجله.
  test("لا يذكر أي مبلغ ولا أي شرط مالي عام", () => {
    const text = buildTrustPoints(0).join(" ");
    expect(text).not.toMatch(/الحد الأدنى للطلب|أقل طلب|أقل قيمة/);
    expect(text).not.toMatch(/\d[\d.,]*\s*درهم/);
  });

  // «بلا حد أدنى» وعدٌ مطلق تكذّبه الكمية الدنيا لكل منتج.
  test("لا يعد الزبون بحرية مطلقة في الكمية", () => {
    expect(buildTrustPoints(0).join(" ")).not.toMatch(/بلا حد أدنى|أي كمية/);
  });
});
