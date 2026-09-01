import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOP_DEMAND_SKUS, TOP_DEMAND_LIMIT } from "@/lib/catalog/topDemand";

/**
 * الصفحة الرئيسية يجب أن تُري سلعة قبل أن تطلب تمريراً.
 *
 * القياس الذي أوجب هذا (25–31 أغسطس، `analytics_events`): من 2,068 جلسة
 * هبطت على `/`، غادرت **1,557** بلا أي تفاعل — لا فتح منتج ولا إضافة للسلة
 * ولا شيء. والجلسات هذه أطلقت أحداث القياس فعلاً، أي أن الصفحة حُمِّلت
 * وعمل فيها JavaScript؛ فالمشكلة ليست تحميلاً بل ما يراه الزائر حين تصل.
 *
 * وما كان يراه: هيرو نصّي، ثم شرح الطلب، ثم **13 بطاقة تصنيف** بنسبة 4:5
 * وعرض الشاشة كاملاً — نحو 6,240 بكسل — قبل أول منتج. أي تسع شاشات هاتف
 * تقريباً قبل أن يظهر شيء بثمن.
 *
 * هذه الاختبارات تحرس البنية لا الشكل: أن يسبق قسمُ المنتجات التصنيفاتِ في
 * ترتيب الصفحة، وأن تبقى القائمة التلقائية مبنية على القياس.
 *
 * والقائمة المقاسة صارت **احتياطاً فقط**: صاحب المتجر يختار منتجات القسم
 * ويرتّبها بالأرقام من /admin/featured، وهو يعرف عن سلعته ما لا يعرفه أسبوع
 * من الأرقام. القياس يعمل حين لا اختيار يدوي بعد.
 */

const PAGE_SOURCE = readFileSync(
  join(process.cwd(), "src/app/(storefront)/page.tsx"),
  "utf-8"
);

describe("ترتيب الصفحة: منتج قبل تمرير", () => {
  test("قسم «الأكثر طلباً» يسبق قسم التصنيفات في الصفحة", () => {
    const topDemandAt = PAGE_SOURCE.indexOf("الأكثر طلباً");
    const categoriesAt = PAGE_SOURCE.indexOf('id="categories"');

    expect(topDemandAt).toBeGreaterThan(-1);
    expect(categoriesAt).toBeGreaterThan(-1);
    expect(topDemandAt).toBeLessThan(categoriesAt);
  });

  test("التصنيفات لم تعد بطاقة واحدة بعرض الشاشة لكل صف", () => {
    // grid-cols-1 على الهاتف هو بالضبط ما أنتج 6,240 بكسل من التمرير.
    expect(PAGE_SOURCE).not.toMatch(/mt-3 grid grid-cols-1 gap-3/);
    expect(PAGE_SOURCE).toMatch(/grid-cols-2[^"]*sm:grid-cols-3/);
  });

  test("أول بطاقتين فوق الطيّة تُحمَّلان بأولوية لا بكسل", () => {
    expect(PAGE_SOURCE).toMatch(/priority=\{index < 2\}/);
  });

  test("لا صورة تصنيف تُحجز بأولوية — لم تعد أيٌّ منها فوق الطيّة", () => {
    const categoriesBlock = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('id="categories"'));
    expect(categoriesBlock).not.toMatch(/priority=\{index === 0\}/);
  });
});

describe("قائمة الأكثر طلباً", () => {
  test("تحمل الغازات الأربعة — وهي أكثر من نصف كل مشاهدات الكتالوج", () => {
    for (const sku of [
      "TF-RF-R134-900g",
      "TF-RF-R134-2-5KG",
      "TF-RF-R22-900g",
      "TF-RF-R22-3KG",
    ]) {
      expect(TOP_DEMAND_SKUS).toContain(sku);
    }
  });

  test("الأعلى إضافةً للسلة يأتي أولاً، لا الأعلى مشاهدةً", () => {
    // R134-900g: 32 إضافة مقابل 15 لـ2.5KG رغم أن الأخير أكثر مشاهدةً.
    // الإضافة للسلة نيّة شراء أوضح من المشاهدة، فتتقدّم عليها.
    expect(TOP_DEMAND_SKUS[0]).toBe("TF-RF-R134-900g");
  });

  test("بلا تكرار، وبالحجم المتوقَّع", () => {
    expect(new Set(TOP_DEMAND_SKUS).size).toBe(TOP_DEMAND_SKUS.length);
    expect(TOP_DEMAND_SKUS.length).toBe(TOP_DEMAND_LIMIT);
  });

  test("لا تحتوي منتجاً بلا طلب مقاس", () => {
    // هذه كانت تتصدّر الصفحة بترتيب الكتالوج الافتراضي بلا أي طلب يذكر.
    for (const sku of ["TF-RF-013", "TF-WM-024", "TF-CK-003"]) {
      expect(TOP_DEMAND_SKUS).not.toContain(sku);
    }
  });
});

describe("الاختيار اليدوي يسبق القياس", () => {
  test("الصفحة تقرأ اختيار الإدارة، لا الأكواد المقاسة وحدها", () => {
    expect(PAGE_SOURCE).toMatch(/getFeaturedProducts/);
  });

  test("القياس احتياط لا شريك: أحد المصدرين كاملاً، بلا خلط", () => {
    // خلط المصدرين كان سيُظهر منتجاً لم يخترْه المدير وسط اختياره، فلا يعود
    // يعرف لماذا ظهر.
    expect(PAGE_SOURCE).toMatch(
      /featured\.length > 0 \? featured : measuredTopDemand/
    );
  });
});
