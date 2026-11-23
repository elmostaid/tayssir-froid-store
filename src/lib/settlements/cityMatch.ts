/**
 * مقارنة مدينة الفاتورة (بالحروف اللاتينية: «Tahla») بمدينة الطلبية (82% منها
 * بالعربية في الإنتاج: «تاهلة»).
 *
 * لا قاموس مدن هنا — المدن والدواوير أكثر من أن تُحصى. بدلاً منه «هيكل
 * الحروف الساكنة»: نحذف الحروف المتحركة ونوحّد الحروف المتقاربة نطقاً في
 * الخطّين، فيصير «Tahla» و«تاهلة» كلاهما «thl»، و«Stehat» و«سطيحات» «stht».
 *
 * النتيجة ثلاثية لا ثنائية، وهذا مقصود:
 *   match    تطابق واضح — يرفع الثقة.
 *   differ   مختلفتان بوضوح — لا يمنع وحده (BigDelivery تكتب أحياناً الدوار:
 *            «Moulay Abellah Amghar» لطلبية مدينتها «El Jadida»)، لكنه يحوّل
 *            الطلبية إلى «تحتاج قرارك» بدل التطبيق التلقائي.
 *   unknown  لا يكفي النص للمقارنة — لا يرفع الثقة ولا يخفضها.
 */

export type CityCheck = "match" | "differ" | "unknown";

const ARABIC_MAP: Record<string, string> = {
  ب: "b", پ: "b", ت: "t", ث: "t", ط: "t", ج: "j", ح: "h", خ: "h", ه: "h",
  د: "d", ذ: "d", ض: "d", ر: "r", ز: "s", س: "s", ش: "s", ص: "s", ظ: "d",
  غ: "k", ف: "f", ڤ: "f", ق: "k", ك: "k", گ: "k", ل: "l", م: "m", ن: "n",
};

function arabicSkeleton(word: string): string {
  const w = word.replace(/^(ال|إل)/, "");
  let out = "";
  for (const ch of w) out += ARABIC_MAP[ch] ?? "";
  return out;
}

function latinSkeleton(word: string): string {
  let w = word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  w = w.replace(/^(el|al)(?=[^aeiou])/, "");
  w = w
    .replace(/kh/g, "h")
    .replace(/gh/g, "k")
    .replace(/ch|sh/g, "s")
    .replace(/ph/g, "f")
    .replace(/dj/g, "j")
    // «Tanger»: g قبل e/i تُنطق ج بالفرنسية.
    .replace(/g(?=[ei])/g, "j")
    .replace(/[qcg]/g, "k")
    .replace(/z/g, "s")
    .replace(/p/g, "b")
    .replace(/x/g, "ks")
    .replace(/[aeiouyw]/g, "");
  return w;
}

/** أسماء لا يجمعها الهيكل الصوتي (اسم عربي غير الاسم اللاتيني). قائمة قصيرة عمداً. */
const ALIASES: [RegExp, string][] = [
  [/الدار\s*البيضاء|البيضاء|كازا(بلانكا)?|dar\s*el\s*beida/gi, "casablanca"],
];

function skeletonTokens(raw: string): string[] {
  let text = raw;
  for (const [re, name] of ALIASES) text = text.replace(re, name);
  return text
    .split(/[\s,.\-_/()،]+/)
    .map((word) => (/[؀-ۿ]/.test(word) ? arabicSkeleton(word) : latinSkeleton(word)))
    .map((s) => s.replace(/(.)\1+/g, "$1"))
    .filter((s) => s.length > 0);
}

export function compareCities(invoiceCity: string | null, orderCity: string | null): CityCheck {
  if (!invoiceCity || !orderCity) return "unknown";
  const a = skeletonTokens(invoiceCity);
  const b = skeletonTokens(orderCity);
  if (a.length === 0 || b.length === 0) return "unknown";
  const joinedA = a.join("");
  const joinedB = b.join("");
  if (joinedA.length < 2 || joinedB.length < 2) return "unknown";
  if (joinedA === joinedB) return "match";
  // كلمة من 3 حروف ساكنة أو أكثر مشتركة («hmd» في «Beni Ahmed chamal» و«بني احمد إقليم الشاون»).
  if (a.some((t) => t.length >= 3 && b.includes(t))) return "match";
  const shorter = joinedA.length <= joinedB.length ? joinedA : joinedB;
  const longer = shorter === joinedA ? joinedB : joinedA;
  if (shorter.length >= 3 && longer.includes(shorter)) return "match";
  return "differ";
}
