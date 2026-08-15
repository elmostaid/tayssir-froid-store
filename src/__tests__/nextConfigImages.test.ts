import { describe, expect, test } from "vitest";
import nextConfig from "../../next.config";

// السبب الجذري المؤكَّد (لقطة شاشة حقيقية من Vercel): 402 PAYMENT_REQUIRED,
// code OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED — حساب Vercel تجاوز الحد
// المسموح لخدمة تحسين الصور المدفوعة (/_next/image)، وهذا يفسّر كل صور
// مكسورة متقطّعة ظهرت خلال هذا التحقيق كاملاً. unoptimized: true يُلغي أي
// اعتماد على تلك الخدمة (كل <Image> يُصيَّر <img> عادي لملف public/
// مباشرة)، فلا يوجد طلب يمكن أن يُرفض بـ402 إطلاقاً. هذا حارس ضد إلغائه
// بالخطأ مستقبلاً — راجع next.config.ts للتاريخ الكامل والخطر المتبقي
// (ملفات PNG أصلية ضخمة بانتظار migration الاستبدال بـJPEG خفيفة).
describe("next.config images.unoptimized (تفادي 402 من خدمة تحسين الصور المدفوعة)", () => {
  test("unoptimized مضبوط true — لا اعتماد على /_next/image المدفوعة إطلاقاً", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });
});
