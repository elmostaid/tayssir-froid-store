import manifest from "@/lib/images/variant-manifest.json";

/**
 * خريطة الأصول المُعالَجة: مسار الأصل ← بصمة محتواه (اسم نسخه).
 *
 * يكتبها `scripts/generate-image-variants.mts` ولا تُعدَّل يدوياً، ويُنقّيها
 * `scripts/verify-image-variants.mjs` قبل كل بناء. وجودها في المستودع — لا
 * في قاعدة البيانات — مقصود لثلاثة أسباب:
 *
 *   1. **صفر استعلام إضافي.** الشرط الحاكم أن تحسين الصور لا يزيد الضغط
 *      على PostgreSQL. ملف ثابت يُقرأ مرة واحدة عند إقلاع نسخة الخادم.
 *   2. **لا انقطاع أثناء المعالجة التدريجية.** البناء الذي لا يعرف صورةً
 *      يعرضها بأصلها، والذي يعرفها يقدّم نسخها.
 *   3. **التراجع بحذف الملفات وحدها.** حذف النسخ وإفراغ هذا الملف يُعيد
 *      الموقع إلى سلوكه قبل التحسين بالضبط.
 *
 * `Map` تُبنى مرة واحدة عند تحميل الوحدة — بحثٌ بـO(1) لكل صورة.
 */
const variants: ReadonlyMap<string, string> = new Map(
  Object.entries(manifest.variants as Record<string, string>)
);

export function variantKeys(): ReadonlyMap<string, string> {
  return variants;
}

export function variantCount(): number {
  return variants.size;
}
