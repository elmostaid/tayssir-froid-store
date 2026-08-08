export function formatMad(amount: string | number): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  const formatted = new Intl.NumberFormat("ar-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted} درهم`;
}

// عرض الحد الأدنى للطلب فواجهة الزبون فقط: رقم صحيح بلا فواصل عشرية ولا
// فواصل آلاف (مثلاً "1000 درهم" بدل "1.000,00 درهم" التي ينتجها formatMad
// العادي). تنسيق عرض حصراً — القيمة الحقيقية (settings.minOrderAmountMad)
// والحسابات المرتبطة بها (meetsMinimumOrder، نسبة تقدّم السلة، إلخ) تبقى
// بلا أي تغيير.
export function formatMinOrderAmount(amount: number): string {
  return `${Math.round(amount)} درهم`;
}
