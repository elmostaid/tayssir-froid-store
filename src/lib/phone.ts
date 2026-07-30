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
