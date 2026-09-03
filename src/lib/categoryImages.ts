// صور تصنيفات ثابتة (public/categories/) — كل صورة تُظهر الجهاز الرئيسي
// محاطاً بقطع غياره حتى يفهم الزبون مباشرة أننا نبيع القطع وليس الجهاز
// نفسه. مفتاح كل مُدخل هو slug التصنيف الحقيقي كما هو مُخزَّن فقاعدة
// البيانات — وليس اسمه، حتى يبقى الربط صحيحاً حتى لو تغيّر نص الاسم
// لاحقاً. تصنيف واحد بلا صورة مخصَّصة بعد (البانيني) يستعمل الأيقونة
// العامة (CategoryIcon) كما كان دائماً.
//
// كل الصور موحَّدة الآن بصيغة .jpg (JPEG أساسي/baseline، بلا ICC/EXIF،
// 1122×1402 موحَّدة): صورتا "الأوتوماتيكية" و"نصف الأوتوماتيكية" أول من
// حُوِّلتا بعد ظهورهما كأيقونة "broken image" على هاتف أندرويد قديم
// (الفحص الثنائي أظهر حاوية WebP من نوع VP8X موسَّعة تحمل ملف تعريف ألوان
// ICC، بخلاف بقية الصور آنذاك بحاوية VP8 البسيطة). لاحقاً ظهر دليل أوسع:
// نفس الصفحة تتصرف بشكل معكوس بين هاتف iPhone وآخر لصور مختلفة (صورة
// تعمل على هاتف وتنكسر على آخر، والعكس لصورة أخرى) — نمط لا يفسّره عيب
// بنيوي واحد فملف بعينه بقدر ما يفسّره التنسيق غير الموحَّد (WebP/JPEG
// مختلطين) نفسه، ولذلك وُحِّدت كل الصور الـ12 لنفس القالب الآمن،
// واستُبدلت أسماء ملفاتها (لا فقط صيغتها) لضمان طلب المتصفح رابطاً جديداً
// كلياً بدل الاعتماد على أي نسخة مخبَّأة قديمة (cache) للرابط السابق.
export const CATEGORY_IMAGES: Record<string, string> = {
  "standard-washing-machine-parts": "/categories/standard-washing-machine-parts.jpg",
  "automatic-washing-machine-parts": "/categories/automatic-washing-machine-parts.jpg",
  "semi-automatic-washing-machine-parts": "/categories/semi-automatic-washing-machine-parts.jpg",
  "refrigerator-spare-parts": "/categories/refrigerator-spare-parts.jpg",
  "freezer-spare-parts": "/categories/freezer-spare-parts.jpg",
  "split-ac-parts": "/categories/split-ac-parts.jpg",
  "blender-parts": "/categories/blender-parts.jpg",
  "pressure-cooker-parts": "/categories/pressure-cooker-parts.jpg",
  "gas-oven-parts": "/categories/gas-oven-parts.jpg",
  "electric-oven-parts": "/categories/electric-oven-parts.jpg",
  "gas-water-heater-parts": "/categories/gas-water-heater-parts-v2.jpg",
  "electric-water-heater-parts": "/categories/electric-water-heater-parts-v2.jpg",
};

// تصنيفا سخان الماء: لكلٍّ صورته الخاصة منذ 3 شتنبر 2026.
//
// كانا بلا صورة مصمَّمة قبل ذلك لسبب موثَّق: الملفان القديمان
// (gas-water-heater-parts.jpg و electric-water-heater-parts.jpg) كانا
// **متطابقين بايتاً ببايت** (md5 c416b8c6e696d626a998006c13a078a3)، ونصّهما
// المطبوع يقول «قطع غيار سخان الماء الغازي والكهربائي» — صورة واحدة
// صُمِّمت لبطاقة مدموجة لا لبطاقتين. فسقط التصنيفان إلى غلاف من منتجاتهما
// (getCategoryCoverImages) حتى تصل صورتان حقيقيتان منفصلتان.
//
// وقد وصلتا: سخان غازي جداري بقطعه، وسخان كهربائي أسطواني بقطعه، مركَّبتان
// على نفس قالب بقية الصور (720×900، الصورة فوق وخط فاصل ثم اسم التصنيف
// بالعربية) فتبدو البطاقتان كأخواتهما العشر تماماً. الاسم الجديد -v2 مقصود:
// الرابط القديم قد يكون مخبَّأً في متصفّح زبون زار الموقع من قبل، وملفٌّ
// باسم جديد يضمن طلباً جديداً بلا انتظار انتهاء الكاش. الملفان القديمان
// المتطابقان بقيا في public/ ولا يشير إليهما شيء.
export function getCategoryImage(slug: string): string | null {
  return CATEGORY_IMAGES[slug] ?? null;
}
