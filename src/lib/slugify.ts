/**
 * يحوّل نصاً لاتينياً (اسم فرنسي/تقني أو SKU) إلى slug بسيط: أحرف صغيرة
 * وأرقام وشرطات فقط. لا يحاول تحويل الحروف العربية (تُحذف بدل تخمين
 * نطقها) — الأفضل أن يكتب المدير slug يدوياً عندما لا يتوفر اسم لاتيني.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // إزالة علامات التشكيل اللاتينية (é -> e)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
