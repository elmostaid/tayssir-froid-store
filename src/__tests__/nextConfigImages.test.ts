import { describe, expect, test } from "vitest";
import nextConfig from "../../next.config";

// unoptimized: true جُرِّب سابقاً (commit 3099b0b) ثم أُلغي (راجع next.config.ts
// للتاريخ الكامل): أوقف تذبذب صور متقطّعاً على بعض الهواتف، لكن بلا تصغير
// خادم، صور PNG الأصلية الضخمة (متوسط ~1.5 ميغابايت) جعلت كل صفحة تصنيف
// تنقل عشرات الميغابايتات — انقطاعات اتصال حقيقية لزبناء بتغطية ضعيفة، أثر
// أوسع من العطل الأصلي. لهذا يجب أن يبقى محسِّن /_next/image فعّالاً
// (unoptimized ليس true) — هذا الاختبار حارس ضد تفعيله مجدداً بالخطأ قبل
// إتمام الحل طويل المدى (تحويل storage_path لنسخ JPEG خفيفة مسبقة الضغط).
describe("next.config images.unoptimized (خفّة الصفحة على الشبكات الضعيفة)", () => {
  test("unoptimized ليس true — محسِّن /_next/image يبقى فعّالاً لتصغير الصور تلقائياً", () => {
    expect(nextConfig.images?.unoptimized).not.toBe(true);
  });

  test("minimumCacheTTL مرفوع — يقلّل تكرار إعادة توليد نفس الصورة من الصفر", () => {
    expect(nextConfig.images?.minimumCacheTTL).toBeGreaterThan(60);
  });
});
