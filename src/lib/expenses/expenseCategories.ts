/**
 * تصنيفات مصاريف التشغيل — بلا أي استيراد لـ@/lib/db، حتى تُستورَد بأمان من
 * مكوّنات عميل ("use client") مثل نموذج إضافة المصروف.
 *
 * القائمة نفسها مكرَّرة كقيد check في القاعدة (هجرة 20260826000000): هنا
 * للواجهة والتحقق المبكر، وهناك كحقيقة أخيرة لا يتجاوزها أي كود.
 */
export const EXPENSE_CATEGORIES = [
  "advertising",
  "rent",
  "fuel_transport",
  "wages",
  "packaging",
  "supplies",
  "utilities",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  advertising: "إشهار",
  rent: "كراء",
  fuel_transport: "مازوط/نقل",
  wages: "أجور وعمال",
  packaging: "كرتون وتغليف",
  supplies: "لوازم",
  utilities: "ماء وكهرباء",
  other: "أخرى",
};

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

/** اسم التصنيف بالعربية، أو القيمة الخام إن جاءت من صفٍّ أقدم من القائمة. */
export function expenseCategoryLabel(value: string): string {
  return isExpenseCategory(value) ? EXPENSE_CATEGORY_LABELS[value] : value;
}
