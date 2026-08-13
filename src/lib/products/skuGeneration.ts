import { sql } from "@/lib/db";

// يبحث عن الحرفين/الأحرف السابقة لأول "-رقم" فآخر SKU (مثلاً "TF-RF" من
// "TF-RF-009") — يطابق فقط الصيغة المعتمَدة فعلياً على كل SKU حقيقي فالمتجر
// (بادئة حروف-حروف، ثم رقم تسلسلي). مصدر وحيد مشترك بين توليد SKU الفردي
// (generateProductSku فـactions.ts) وتوليد الدفعة (bulkActions.ts) حتى لا
// يتكرر نفس المنطق فمكانين.
export const SKU_PREFIX_NUMBER_RE = /^([A-Za-z]+-[A-Za-z]+)-(\d+)$/;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * يحدِّد بادئة SKU المناسبة لتصنيف مُعطى:
 * 1) إن كان للتصنيف منتجات بصيغة "بادئة-رقم" معتمَدة، البادئة الأكثر
 *    استعمالاً فيه.
 * 2) تصنيف بلا أي منتج بعد: بادئة تُشتَق من slug التصنيف (أول حرف من كل
 *    كلمة، بحد أقصى 3 أحرف) — "TF-" + تلك الأحرف.
 */
export async function computeSkuPrefixForCategory(
  categoryId: number
): Promise<{ prefix: string } | { error: string }> {
  const category = await sql<{ slug: string }[]>`
    select slug from public.categories where id = ${categoryId} limit 1
  `;
  if (!category[0]) return { error: "التصنيف غير موجود." };

  const categorySkus = await sql<{ sku: string }[]>`
    select sku from public.products where category_id = ${categoryId}
  `;

  const prefixCounts = new Map<string, number>();
  for (const row of categorySkus) {
    const match = row.sku.match(SKU_PREFIX_NUMBER_RE);
    if (match) {
      prefixCounts.set(match[1], (prefixCounts.get(match[1]) ?? 0) + 1);
    }
  }

  if (prefixCounts.size > 0) {
    return { prefix: [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0][0] };
  }

  const code =
    category[0].slug
      .split("-")
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 3) || "GEN";
  return { prefix: `TF-${code}` };
}

// أكبر رقم مُستعمَل فعلياً حالياً لبادئة مُعطاة، عبر كل المنتجات (SKU عمود
// unique شامل على مستوى الجدول، وليس فقط داخل التصنيف — نفس ملاحظة
// generateProductSku الأصلية).
export async function findMaxSkuNumber(prefix: string): Promise<number> {
  const existingWithPrefix = await sql<{ sku: string }[]>`
    select sku from public.products where sku like ${prefix + "-%"}
  `;
  const prefixNumberRe = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let maxNumber = 0;
  for (const row of existingWithPrefix) {
    const match = row.sku.match(prefixNumberRe);
    if (match) maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
  }
  return maxNumber;
}
