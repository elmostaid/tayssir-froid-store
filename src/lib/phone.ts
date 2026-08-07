/**
 * يتحقق من رقم هاتف مغربي: يبدأ بـ 0 أو +212، متبوعاً برقم شبكة (5 أو 6 أو 7)
 * ثم 8 أرقام. يقبل مسافات أو شرطات بين الأرقام ويتجاهلها عند الفحص.
 * أمثلة صالحة: 0612345678 / +212612345678 / 06 12 34 56 78
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, "");
}

export function isValidMoroccanPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^(?:\+212|0)[5-7]\d{8}$/.test(normalized);
}

/**
 * يحوّل رقم هاتف مغربي مخزَّن بأي صيغة صالحة (0612345678 أو +212612345678)
 * إلى أرقام دولية خالصة بدون "+" ولا أصفار بادئة (212612345678) — الصيغة
 * اللي يحتاجها رابط wa.me مباشرة، ونفس الأرقام تصلح لـtel: بإضافة "+" فقط.
 * لا تتحقق من صحة الرقم (isValidMoroccanPhone مسؤولة عن هذا) — تفترض رقماً
 * مغربياً صالحاً مُمرَّراً أصلاً.
 */
export function toInternationalDigits(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized.startsWith("+212")) return normalized.slice(1);
  if (normalized.startsWith("0")) return `212${normalized.slice(1)}`;
  return normalized;
}
