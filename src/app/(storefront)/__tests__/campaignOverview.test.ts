import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolveLandingView, OVERVIEW_PREVIEW_SIZE } from "@/app/(storefront)/campaignOverview";
import { resolveTab } from "@/app/(storefront)/campaignLanding";
import { WASHING_TABS } from "@/app/(storefront)/washing-machines/page";
import { HEATER_TABS } from "@/app/(storefront)/water-heaters/page";

/**
 * ما تحرسه هذه الاختبارات ليس تفصيلاً تجميلياً بل عطلاً تجارياً مقيساً:
 * صفحة هبوط إعلانية تفتح تصنيفاً واحداً فتُخفي البقية. في حملة الشوفو
 * انتهت النسبة إلى 46,011 درهماً غازياً مقابل 2,064 كهربائياً، والإعلان
 * كان يعرض الاثنين. فالقاعدة المحروسة: **الدخول المباشر لا يفتح أي نوع.**
 */
describe("الوجه المحايد لصفحة مكينات الصابون", () => {
  test("الدخول بلا ?type= لا يفتح أي تصنيف", () => {
    expect(resolveLandingView(WASHING_TABS, undefined)).toEqual({ mode: "overview" });
  });

  test("الفرق الجوهري عن resolveTab: الغياب لا يعني «الأول»", () => {
    // resolveTab القديمة ترجع التصنيف الأول — وهو بالضبط الانحياز المُصلَح.
    expect(resolveTab(WASHING_TABS).key).toBe("standard");
    // أما الوجه المحايد فلا يختار شيئاً.
    expect(resolveLandingView(WASHING_TABS, undefined).mode).toBe("overview");
  });

  test("كل مفتاح صالح يفتح تصنيفه — الروابط الإعلانية القديمة تبقى تعمل", () => {
    for (const tab of WASHING_TABS) {
      expect(resolveLandingView(WASHING_TABS, tab.key)).toEqual({ mode: "tab", tab });
    }
  });

  /**
   * القيمة تأتي من الرابط، أي من الزائر. لو مرّت إلى `getProducts` كما هي
   * لصارت نصّاً خارجياً في شرط استعلام، ولأمكن عرض صفحة حملة فارغة لأي
   * قيمة عابثة — وهي صفحة يُدفع لها إعلان. الحارس: لا شيء يُقبل إلا مطابقة
   * حرفية لمفتاح مكتوب في الكود، وما عداه يرجع للوجه المحايد.
   */
  test("أي قيمة غريبة ترجع للوجه المحايد ولا تصل للاستعلام", () => {
    for (const bad of ["", "   ", "STANDARD", "../admin", "'; drop table", "gas", "999", "Standard"]) {
      expect(resolveLandingView(WASHING_TABS, bad).mode).toBe("overview");
    }
  });

  /** `?type=a&type=b` يصل مصفوفةً من Next.js — تُرفض بلا إسقاط الصفحة. */
  test("المصفوفة (type مكرَّر في الرابط) ترجع للوجه المحايد", () => {
    expect(resolveLandingView(WASHING_TABS, ["standard", "semi"]).mode).toBe("overview");
    expect(resolveLandingView(WASHING_TABS, ["standard"]).mode).toBe("overview");
    expect(resolveLandingView(WASHING_TABS, []).mode).toBe("overview");
  });

  test("للأنواع الثلاثة اسم كامل مكتوب بصيغة الإعلان", () => {
    expect(WASHING_TABS.map((tab) => tab.fullLabel)).toEqual([
      "مكينة الصابون العادية",
      "مكينة الصابون نصف أوتوماتيك",
      "مكينة الصابون أوتوماتيك",
    ]);
    // والاسم القصير يبقى للزرّ داخل شريط التبويبات.
    expect(WASHING_TABS.map((tab) => tab.label)).toEqual([
      "العادية",
      "نصف أوتوماتيك",
      "أوتوماتيك",
    ]);
  });

  /**
   * التساوي البصري لا يكفي إن كان أحد الأنواع يعرض منتجات أكثر: عدد واحد
   * مشترك هو ما يجعل «متساوية» قابلة للتحقّق لا مجرّد نيّة.
   */
  test("عدد المنتجات المعروضة واحد للأنواع كلها، وصغير بما يكفي للهاتف", () => {
    expect(OVERVIEW_PREVIEW_SIZE).toBe(4);
    // ثلاثة أنواع × 4 = 12 منتجاً، لا 182.
    expect(OVERVIEW_PREVIEW_SIZE * WASHING_TABS.length).toBe(12);
  });

  /**
   * صفحة الشوفو لا تستعمل الوجه المحايد إطلاقاً، وهذا مقصود: الحملة
   * موقوفة، والتعديل يخصّ صفحة هبوط واحدة. الاختبار يمنع أن يُسحب سلوكها
   * معنا بالسهو.
   */
  test("تبويبات الشوفو لم تُمسّ: لا أسماء كاملة ولا ترتيب مختلف", () => {
    expect(HEATER_TABS.map((tab) => tab.key)).toEqual(["gas", "electric"]);
    expect(HEATER_TABS.every((tab) => tab.fullLabel === undefined)).toBe(true);
    expect(resolveTab(HEATER_TABS).categorySlug).toBe("gas-water-heater-parts");
  });

  /**
   * الزرّ الكبير يجب أن يقع **بعد** شبكة المنتجات لا قبلها: من قرأ
   * المنتجات الأربعة يصل إلى نهاية القسم، ولو لم يجد هناك مخرجاً انتقل
   * إلى النوع التالي ظانّاً أنه رأى كل شيء. حارسٌ نصّي لأن المكوّن خادمي
   * ولا يُصيَّر في هذه الحزمة — والترتيب هو بالضبط ما انكسر.
   */
  describe("زرّ «عرض جميع قطع غيار …» أسفل كل قسم", () => {
    const source = readFileSync("src/app/(storefront)/campaignOverview.tsx", "utf8");

    test("نصّ الزرّ مبنيّ من الاسم الكامل للنوع", () => {
      expect(source).toContain("عرض جميع قطع غيار {tab.fullLabel ?? tab.label}");
      // أي أن الأزرار الثلاثة تقرأ حرفياً:
      for (const tab of WASHING_TABS) {
        expect(`عرض جميع قطع غيار ${tab.fullLabel}`).toMatch(/^عرض جميع قطع غيار مكينة الصابون /);
      }
    });

    test("الزرّ يقع بعد شبكة المنتجات، وداخل نفس القسم", () => {
      const grid = source.indexOf("products.map((product, index)");
      const button = source.indexOf("عرض جميع قطع غيار");
      const sectionEnd = source.indexOf("</section>", grid);
      expect(grid).toBeGreaterThan(-1);
      expect(button).toBeGreaterThan(grid);
      expect(button).toBeLessThan(sectionEnd);
    });

    test("الزرّ يفتح التبويب لا تصنيفاً خارجياً، وبلا جلب مسبق", () => {
      const button = source.indexOf("عرض جميع قطع غيار");
      const anchorStart = source.lastIndexOf("<Link", button);
      const anchor = source.slice(anchorStart, button);
      expect(anchor).toContain("href={typeHref}");
      expect(anchor).toContain("prefetch={false}");
      // typeHref = `${basePath}?type=${tab.key}` — نفس نظام التبويبات.
      expect(source).toContain("const typeHref = `${basePath}?type=${tab.key}`");
    });

    test("مساحة ضغط لا تقلّ عن 48px وبعرض الشاشة", () => {
      const button = source.indexOf("عرض جميع قطع غيار");
      const anchor = source.slice(source.lastIndexOf("<Link", button), button);
      expect(anchor).toContain("min-h-12");
      expect(anchor).toContain("w-full");
    });

    test("لا يحمّل منتجات إضافية: رابط تنقّل لا زرّ تحميل", () => {
      // LoadMoreProducts يبقى حصراً في التبويب (campaignLanding)، فالوجه
      // المحايد لا يجلب أكثر من 4 لكل نوع مهما ضُغط فيه.
      expect(source).not.toContain("LoadMoreProducts");
    });
  });
});
