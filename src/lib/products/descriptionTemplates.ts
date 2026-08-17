/**
 * وصف تلقائي آمن للمنتجات المضافة عبر "إضافة مجموعة منتجات".
 *
 * لا يستعمل أي خدمة ذكاء اصطناعي خارجية، ولا يخترع أي مواصفة تقنية أو ماركة
 * أو توافق مع جهاز معيّن. النص ثابت ومكتوب مسبقاً، ومهمته الوحيدة أن ينبّه
 * الزبون إلى مقارنة القطعة قبل الطلب — وهي معلومة صحيحة لكل قطعة غيار بلا
 * استثناء، بعكس أي وصف مولَّد قد يدّعي توافقاً غير مؤكَّد.
 */
export const DEFAULT_DESCRIPTION_TEMPLATE =
  "قطعة غيار مخصصة للاستبدال. يرجى مقارنة شكل القطعة، الفيشة، الأطراف، القياسات ومواضع التثبيت مع القطعة الأصلية قبل الطلب. إذا لم تكن متأكداً من التوافق، تواصل معنا قبل تأكيد الطلب.";

/**
 * قوالب خاصة بتصنيفات بعينها، مفتاحها slug التصنيف. فارغة الآن عمداً: كل
 * التصنيفات الحالية قطع غيار ويناسبها القالب الافتراضي. إضافة تصنيف بقالب
 * مختلف مستقبلاً لا تحتاج إلا سطراً واحداً هنا، بلا تعديل أي منطق.
 *
 * مثال (غير مُفعَّل): "cooling-tools": "أداة عمل مهنية…"
 */
export const CATEGORY_DESCRIPTION_TEMPLATES: Record<string, string> = {};

export function resolveDescriptionTemplate(categorySlug: string | null): string {
  if (categorySlug && CATEGORY_DESCRIPTION_TEMPLATES[categorySlug]) {
    return CATEGORY_DESCRIPTION_TEMPLATES[categorySlug];
  }
  return DEFAULT_DESCRIPTION_TEMPLATE;
}

/**
 * الوصف النهائي: وصف مشترك اختياري يكتبه صاحب المتجر للدفعة كلها، ثم القالب
 * الآمن للتصنيف. الترتيب مقصود — المعلومة التي كتبها الإنسان أولاً.
 */
export function buildProductDescription(
  sharedDescription: string,
  categorySlug: string | null
): string {
  const shared = sharedDescription.trim();
  const template = resolveDescriptionTemplate(categorySlug);
  return shared ? `${shared}\n\n${template}` : template;
}
