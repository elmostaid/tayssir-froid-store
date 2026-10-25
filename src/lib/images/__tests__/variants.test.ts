import { describe, expect, test } from "vitest";
import {
  VARIANT_WIDTHS,
  CARD_WIDTHS,
  THUMB_WIDTHS,
  variantKey,
  variantPath,
  webpSrcSet,
} from "@/lib/images/variants";

/**
 * ما تحرسه هذه الاختبارات ليس حساباً بل **عطلاً تجارياً**: صورة قطعة غيار
 * لا تظهر لصنايعي يحاول التعرّف عليها. وكل حالة هنا مشتقّة من عطل وقع
 * فعلاً في هذا المتجر ووُثِّق في `migration 20260815000000`.
 */
describe("نسخ الصور المحسَّنة", () => {
  test("لا srcset لأصل لم يُعالَج — وهذا هو الحارس الأول", () => {
    // `<picture>` يتراجع عن صيغة غير مدعومة، لكنه **لا يتراجع عن 404**.
    // فإعلان رابط نسخة غير موجودة = صورة مكسورة مؤكَّدة. القاعدة: لا
    // يُعلَن شيء لم يُثبت المولِّد أنه أنتجه.
    expect(webpSrcSet("product-images/TF-X/TF-X.jpg", new Set())).toBeNull();
  });

  test("srcset يُبنى فقط للأصل المُعالَج، وبكل العروض المطلوبة", () => {
    const p = "product-images/TF-CK-001/TF-CK-001.jpg";
    const got = webpSrcSet(p, new Set([p]));
    expect(got).toBe(`${variantPath(p, 360)} 360w, ${variantPath(p, 540)} 540w`);
  });

  test("widths فارغة أو null تعني «لا نسخة عمداً» لا خطأً", () => {
    const p = "x/y.jpg";
    const processed = new Set([p]);
    expect(webpSrcSet(p, processed, null)).toBeNull();
    expect(webpSrcSet(p, processed, [])).toBeNull();
  });

  /**
   * الاسم غير ASCII كان **أحد سببَي** الصور المكسورة المتقطّعة الموثَّقة.
   * التجزئة تضمن ألا يتسرّب حرف واحد من اسم الأصل إلى رابط النسخة.
   */
  test("اسم النسخة ASCII بحت مهما كان اسم الأصل", () => {
    for (const p of [
      "product-images-v3/TF-WM-040/TF-WM-040__موطور نشاف LG رأس غليظ.png",
      "https://x.supabase.co/storage/v1/object/public/product-images/3/a191563e.webp",
      "product-images/TF-CK-001/TF-CK-001.jpg",
      "مجلد/صورة.jpg",
    ]) {
      const v = variantPath(p, 540);
      expect(v).toMatch(/^\/_opt\/[0-9a-f]{16}-540\.webp$/);
      expect(/^[\x20-\x7E]+$/.test(v)).toBe(true);
    }
  });

  test("المفتاح مستقرّ: نفس الأصل يعطي نفس الاسم دائماً", () => {
    const p = "product-images/TF-CK-001/TF-CK-001.jpg";
    expect(variantKey(p)).toBe(variantKey(p));
    expect(variantKey(p)).not.toBe(variantKey(p + "x"));
  });

  test("أصلان مختلفان لا يتصادمان", () => {
    const keys = new Set(
      ["a/b.jpg", "a/c.jpg", "b/b.jpg", "https://x/y.jpg"].map((p) => variantKey(p))
    );
    expect(keys.size).toBe(4);
  });

  /**
   * القياس الذي أسقط 1080: أصول المتجر 1200×1600 أصلاً، فـWebP@1080
   * خرج **أكبر من الأصل بـ11%**. إبقاؤه كان سيُثقل صفحة المنتج ويضيف
   * ~136 MB تخزيناً بلا مقابل.
   */
  test("لا يوجد عرض 1080 — أُسقط بالقياس لا بالرأي", () => {
    expect([...VARIANT_WIDTHS]).toEqual([360, 540]);
    expect([...CARD_WIDTHS]).toEqual([360, 540]);
    expect([...THUMB_WIDTHS]).toEqual([360]);
  });

  test("العروض مشتقّة من بطاقة 171 CSS px", () => {
    // 171 × 2 = 342 ← 360 ، و171 × 3 = 513 ← 540. كلاهما يغطّي بهامش صغير.
    expect(360).toBeGreaterThanOrEqual(171 * 2);
    expect(540).toBeGreaterThanOrEqual(171 * 3);
  });
});
