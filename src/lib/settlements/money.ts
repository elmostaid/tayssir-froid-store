/**
 * المبالغ داخل نظام التسويات تُحسَب بالسنتيم (أعداد صحيحة) لا بالدرهم العشري:
 * المطابقة تشترط التساوي **بالضبط**، و0.1 + 0.2 ≠ 0.3 في الأعداد العشرية.
 */

export type Cents = number;

/** «1 075,50 DH» أو «-20 DH» أو «718» → سنتيم. null إن لم يكن رقماً واضحاً. */
export function parseMadToCents(raw: string): Cents | null {
  const cleaned = raw
    .replace(/DH|MAD|درهم/gi, "")
    .replace(/[\s  ]/g, "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** قيمة numeric من القاعدة («718.00») → سنتيم. */
export function dbMoneyToCents(value: string | number | null): Cents | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function centsToMad(cents: Cents): number {
  return cents / 100;
}

/** «2.00» كما تُكتب في عمود numeric — للكتابة في القاعدة وللسجل. */
export function centsToDb(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

/** آخر 9 أرقام من هاتف مغربي، أو null إن كان أقصر. */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/**
 * تاريخ وصول الفلوس للبنك كما يُدخله المالك: «2026-11-27» ← نفس النص؛ فارغ ←
 * null (اليوم)؛ غير صالح أو فالمستقبل ← "invalid".
 */
export function parseReceivedDay(raw: string, today = new Date()): string | null | "invalid" {
  const value = raw.trim();
  if (value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "invalid";
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return "invalid";
  if (value > today.toISOString().slice(0, 10)) return "invalid";
  return value;
}
