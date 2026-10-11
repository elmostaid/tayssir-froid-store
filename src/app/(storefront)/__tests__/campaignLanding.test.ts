import { describe, expect, test } from "vitest";
import { resolveTab, CAMPAIGN_PAGE_SIZE } from "@/app/(storefront)/campaignLanding";
import { WASHING_TABS } from "@/app/(storefront)/washing-machines/page";
import { HEATER_TABS } from "@/app/(storefront)/water-heaters/page";

describe("تبويبات صفحات الحملة", () => {
  test("مكينات الصابون: ثلاثة أنواع، والعادية هي الافتراضي", () => {
    expect(WASHING_TABS.map((t) => t.key)).toEqual(["standard", "semi", "automatic"]);
    expect(WASHING_TABS[0].label).toBe("العادية");
    expect(resolveTab(WASHING_TABS).categorySlug).toBe("standard-washing-machine-parts");
  });

  test("الشوفو: نوعان، والغازي هو الافتراضي", () => {
    expect(HEATER_TABS.map((t) => t.key)).toEqual(["gas", "electric"]);
    expect(resolveTab(HEATER_TABS).categorySlug).toBe("gas-water-heater-parts");
  });

  /**
   * العطل الذي يحرسه: `?type=` يأتي من الرابط، أي من الزائر. لو مرّ إلى
   * `getProducts` كما هو، لصار نصّاً من الخارج داخل شرط الاستعلام، ولأمكن
   * أن تُعرض صفحة حملة فارغة لأي قيمة عابثة — وهي صفحة يُدفع لها إعلان.
   * الحارس: القيمة تُطابَق على القائمة المكتوبة في الكود، والـslug يُؤخذ
   * من القائمة لا من الرابط.
   */
  test("قيمة غريبة في الرابط ترجع للافتراضي بدل أن تصل للاستعلام", () => {
    for (const bad of ["", "   ", "STANDARD", "../admin", "'; drop table", "gas", "999"]) {
      const tab = resolveTab(WASHING_TABS, bad);
      expect(WASHING_TABS).toContain(tab);
    }
    expect(resolveTab(WASHING_TABS, "nope").key).toBe("standard");
    // "gas" تبويبٌ صالح في صفحة الشوفو، لكنه غريب هنا — فيُرفض.
    expect(resolveTab(WASHING_TABS, "gas").key).toBe("standard");
  });

  test("كل تبويب يشير إلى تصنيف حقيقي موجود في المتجر", () => {
    const real = new Set([
      "standard-washing-machine-parts",
      "semi-automatic-washing-machine-parts",
      "automatic-washing-machine-parts",
      "gas-water-heater-parts",
      "electric-water-heater-parts",
    ]);
    for (const tab of [...WASHING_TABS, ...HEATER_TABS]) {
      expect(real.has(tab.categorySlug)).toBe(true);
    }
  });

  test("مفاتيح التبويبات فريدة داخل كل صفحة", () => {
    for (const tabs of [WASHING_TABS, HEATER_TABS]) {
      expect(new Set(tabs.map((t) => t.key)).size).toBe(tabs.length);
      expect(new Set(tabs.map((t) => t.categorySlug)).size).toBe(tabs.length);
    }
  });

  // نفس حجم دفعة صفحة التصنيف: أي اختلاف هنا يعني سلوكاً مختلفاً لنفس
  // الزبون بين صفحتين، وتحميلاً أثقل على الهاتف من حيث لا يُنتظَر.
  test("حجم الدفعة 24 كما في بقية المتجر", () => {
    expect(CAMPAIGN_PAGE_SIZE).toBe(24);
  });
});
