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
};

// ⚠️ تصنيفا سخان الماء (الغازي والكهربائي) حُذفا من هذه الخريطة عمداً.
//
// الدليل: public/categories/gas-water-heater-parts.jpg و
// electric-water-heater-parts.jpg ملفان **متطابقان بايتاً ببايت**
// (md5 c416b8c6e696d626a998006c13a078a3 لكليهما، ونفس التطابق فنسختي
// .webp)، ونصّ الصورة المطبوع داخلها يقول حرفياً «قطع غيار سخان الماء
// الغازي والكهربائي» — أي أنها صُمِّمت لبطاقة واحدة مدموجة، لا لبطاقتين.
// وتاريخ git يُظهر الملفين متطابقين منذ أول commit أضافهما (13 غشت)، فلا
// توجد فالمشروع نسخة أصلية منفصلة لأيٍّ منهما يمكن استرجاعها.
//
// أما التصنيفان فمنفصلان تماماً فقاعدة البيانات ولم يُدمجا قطّ: التصنيف 7
// «قطع غيار سخان الماء الغازي» بـ23 منتجاً منشوراً (TF-GWH-*) والتصنيف 8
// «قطع غيار سخان الماء الكهربائي» بـ8 منتجات (TF-EWH-*)، بلا أي تداخل.
// المشكلة كانت فالصورة وحدها.
//
// فبدل تكرار نفس الصورة على بطاقتين، أو اختراع صورة جديدة، يسقط التصنيفان
// إلى غلاف من منتجاتهما هما (getCategoryCoverImages فـqueries/catalog.ts)
// مع اسم التصنيف مكتوباً نصاً — فلكلٍّ صورة قطعة من قطعه واسمه الصحيح.
export function getCategoryImage(slug: string): string | null {
  return CATEGORY_IMAGES[slug] ?? null;
}
