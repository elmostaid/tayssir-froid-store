import { sql } from "@/lib/db";
import { escapeRegExp } from "@/lib/products/skuGeneration";

/**
 * اسم تلقائي للمنتجات التي يضيفها صاحب المتجر بلا اسم — يشتق من اسم التصنيف
 * نفسه ورقم تسلسلي، مثل: "قفل باب مكينة الصابون الأوتوماتيكية - موديل 01".
 *
 * قاعدة صارمة مقصودة: لا نخترع أبداً ماركة (LG، Samsung، Haier…) ولا رقم
 * موديل جهاز ولا أي مواصفة تقنية. الاسم المولَّد لا يحتوي إلا على اسم
 * التصنيف كما هو في قاعدة البيانات ورقم ترتيبي محايد. أي معلومة تجارية
 * حقيقية يكتبها صاحب المتجر بنفسه في خانة الاسم، وعندها لا يُولَّد شيء.
 */
export const AUTO_NAME_SEPARATOR = " - موديل ";

export function buildAutoProductName(categoryName: string, sequence: number): string {
  return `${categoryName}${AUTO_NAME_SEPARATOR}${String(sequence).padStart(2, "0")}`;
}

/**
 * أكبر رقم مستعمل فعلياً في الأسماء المولَّدة تلقائياً داخل تصنيف معيّن.
 *
 * الترقيم يُكمِل ما هو موجود بدل أن يبدأ من 01 في كل دفعة — نفس منطق
 * findMaxSkuNumber للـSKU بالضبط. لولا ذلك لكانت الدفعة الثانية تُنتج
 * "موديل 01" من جديد فيُرفَض كل منتجاتها كمكرَّرة (الاسم مكرَّر داخل نفس
 * التصنيف)، وهو ما يجعل الميزة عديمة الفائدة بعد أول استعمال.
 */
export async function findMaxAutoNameNumber(
  categoryId: number,
  categoryName: string
): Promise<number> {
  const rows = await sql<{ name_ar: string }[]>`
    select name_ar from public.products
    where category_id = ${categoryId}
      and name_ar like ${categoryName + AUTO_NAME_SEPARATOR + "%"}
  `;
  const re = new RegExp(
    `^${escapeRegExp(categoryName)}${escapeRegExp(AUTO_NAME_SEPARATOR)}(\\d+)$`
  );
  let max = 0;
  for (const row of rows) {
    const match = row.name_ar.match(re);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max;
}

/** اسم التصنيف كما هو مخزَّن — مصدر الاسم المولَّد. */
export async function getCategoryName(categoryId: number): Promise<string | null> {
  const rows = await sql<{ name_ar: string }[]>`
    select name_ar from public.categories where id = ${categoryId} limit 1
  `;
  return rows[0]?.name_ar ?? null;
}
