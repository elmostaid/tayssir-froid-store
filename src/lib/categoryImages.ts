// صور تصنيفات ثابتة (public/categories/) — كل صورة تُظهر الجهاز الرئيسي
// محاطاً بقطع غياره حتى يفهم الزبون مباشرة أننا نبيع القطع وليس الجهاز
// نفسه. مفتاح كل مُدخل هو slug التصنيف الحقيقي كما هو مُخزَّن فقاعدة
// البيانات — وليس اسمه، حتى يبقى الربط صحيحاً حتى لو تغيّر نص الاسم
// لاحقاً. تصنيف واحد بلا صورة مخصَّصة بعد (البانيني) يستعمل الأيقونة
// العامة (CategoryIcon) كما كان دائماً.
//
// صورتا "الأوتوماتيكية" و"نصف الأوتوماتيكية" تحديداً بصيغة .jpg وليس
// .webp: ظهرتا كأيقونة "broken image" على هاتف أندرويد قديم حقيقي بينما كل
// الصور الأخرى (.webp) تعمل بشكل طبيعي على نفس الهاتف — الفحص الثنائي أظهر
// أن ملف "نصف الأوتوماتيكية" الأصلي كان WebP بحاوية VP8X الموسَّعة (تحمل
// ملف تعريف ألوان ICC) بخلاف كل الصور الأخرى العاملة (حاوية VP8 البسيطة
// فقط) — اختلاف بنيوي حقيقي فصيغة الترميز الداخلية، وليس مجرد الامتداد.
// تحويلهما إلى JPEG أساسي (baseline) بدون ICC/EXIF يزيل هذا المتغيّر
// كلياً (JPEG الأساسي مدعوم فكل جهاز/متصفح عملياً بلا استثناء تقريباً).
export const CATEGORY_IMAGES: Record<string, string> = {
  "standard-washing-machine-parts": "/categories/standard-washing-machine-parts.webp",
  "automatic-washing-machine-parts": "/categories/automatic-washing-machine-parts.jpg",
  "semi-automatic-washing-machine-parts": "/categories/semi-automatic-washing-machine-parts.jpg",
  "refrigerator-spare-parts": "/categories/refrigerator-spare-parts.webp",
  "freezer-spare-parts": "/categories/freezer-spare-parts.webp",
  "split-ac-parts": "/categories/split-ac-parts.webp",
  "blender-parts": "/categories/blender-parts.webp",
  "pressure-cooker-parts": "/categories/pressure-cooker-parts.webp",
  "gas-water-heater-parts": "/categories/gas-water-heater-parts.webp",
  "electric-water-heater-parts": "/categories/electric-water-heater-parts.webp",
  "gas-oven-parts": "/categories/gas-oven-parts.webp",
  "electric-oven-parts": "/categories/electric-oven-parts.webp",
};

export function getCategoryImage(slug: string): string | null {
  return CATEGORY_IMAGES[slug] ?? null;
}
