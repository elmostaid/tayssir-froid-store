/**
 * ثوابت ومنطق فحص صورة المنتج قبل الرفع — بلا أي استيراد خادمي (fs، إلخ)،
 * فهي آمنة للاستيراد من مكوّنات "use client" مباشرة (الفحص الفوري فالمتصفح
 * قبل طلب رابط الرفع الموقَّع)، وأيضاً من الخادم (Server Actions).
 */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 ميجابايت
export const MAX_IMAGES_PER_PRODUCT = 5;

export const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return "صيغة الصورة غير مدعومة. استعمل JPG أو PNG أو WEBP فقط.";
  }
  if (file.size === 0) {
    return "الملف فارغ.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "حجم الصورة كبير جداً (5 ميجابايت كحد أقصى).";
  }
  return null;
}
