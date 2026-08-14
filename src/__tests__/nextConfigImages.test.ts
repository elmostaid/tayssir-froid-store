import { describe, expect, test } from "vitest";
import nextConfig from "../../next.config";

// حارس ضد فقدان unoptimized: true بالخطأ مستقبلاً — بدونه، مُحسِّن
// /_next/image يعود لسلوكه الافتراضي (تحويل أي صورة إلى مخرَج WebP لأي
// عميل يُصرِّح بدعمه عبر ترويسة Accept، بغض النظر عن صيغة الملف الأصلي)،
// وهو بالضبط السبب المؤكَّد وراء ظهور بعض صور التصنيفات/المنتجات كأيقونة
// "broken image" على هواتف حقيقية (آيفون وأندرويد أقدم) رغم أن الملفات
// نفسها سليمة على القرص. انظر next.config.ts للتفاصيل الكاملة.
describe("next.config images.unoptimized (توافق أقصى مع الهواتف/المتصفحات القديمة)", () => {
  test("unoptimized مضبوط true — كل صورة تصل المتصفح بنفس صيغتها الأصلية دائماً، بلا أي إعادة ترميز خادم", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });
});
