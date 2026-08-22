import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * حاجز الحد الأدنى للطلب (1000 درهم) أُلغي نهائياً. هذا الاختبار يحرس
 * الوجه الآخر للإلغاء: ألّا يبقى — ولا يعود — أي نصّ يقول للزبون إن هناك
 * مبلغاً أدنى للشراء.
 *
 * السبب أن جملة واحدة منسيّة تكفي: زبون قرأ في الـFooter أن «الحد الأدنى
 * للطلبية 1000 درهم» سيغادر بسلّة 300 درهم دون أن يجرّب أصلاً، مهما كان
 * الخادم يقبلها. النص هو الحاجز الحقيقي بالنسبة له، لا الكود.
 *
 * الكمية الدنيا لكل منتج شيء آخر تماماً وتبقى كما هي: هي قيد على منتج
 * بعينه لا شرط مالي عام، ولها نصوصها المشروعة («الكمية الدنيا: 10 قطع»).
 */

const STOREFRONT_ROOTS = [
  "src/app/(storefront)",
  "src/components",
  "src/lib/whatsapp.ts",
];

// صياغات تعني «هناك مبلغ أدنى للشراء». نتعمّد ألّا نمنع كلمة «الكمية
// الدنيا» ولا رسالة resolveLines عن كمية المنتج — تلك قيود منتجات لا مال.
const FORBIDDEN = [
  /الحد الأدنى للطلب/,
  /الحد الأدنى للطلبية/,
  /أقل طلب/,
  /أقل قيمة للطلب/,
  /بلغ الحد الأدنى/,
];

// التعليقات تشرح لماذا حُذف الحاجز، فهي تذكر العبارات نفسها بطبيعة الحال.
// الزبون لا يقرأ التعليقات — نحذفها قبل الفحص لئلّا يمنعنا الاختبار من
// توثيق ما فعلناه.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function collect(path: string, out: string[] = []): string[] {
  const stats = statSync(path);
  if (stats.isFile()) {
    if (/\.tsx?$/.test(path) && !path.includes("__tests__")) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    collect(join(path, entry), out);
  }
  return out;
}

describe("لا نصّ يذكر حدّاً أدنى لقيمة الطلب في واجهة الزبون", () => {
  const files = STOREFRONT_ROOTS.flatMap((root) => collect(root));

  test("توجد ملفات فعلاً للفحص (حتى لا ينجح الاختبار بالصمت)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test.each(files)("%s", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    const hits = FORBIDDEN.filter((pattern) => pattern.test(code)).map(String);
    expect(hits).toEqual([]);
  });
});
