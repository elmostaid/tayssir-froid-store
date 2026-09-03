import { describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { PUBLICLY_VISIBLE_STATUSES } from "@/lib/catalog/visibility";

/**
 * الحارس الذي يمنع تكرار العطل نفسه.
 *
 * العطل الأصلي لم يكن خطأ حساب: كان تعريفين مختلفين لكلمة «منتجات». العرض
 * `catalog_products` يستبعد المسودّات، وكود الترقيم كان يشملها — فانحرف
 * الرقم المكتوب عن الموضع المعروض بمقدار عدد المخفيّات قبله.
 *
 * هذا الاختبار يقرأ **تعريف العرض من القاعدة نفسها** ويتأكّد أن كل حالة في
 * ثابتنا مذكورة فيه، وأن شرط العرض لا يقبل حالة خارج الثابت. تغييرُ أحدهما
 * بلا الآخر يسقط هنا، لا في صفحة تصنيف بعد أسبوع.
 */
const viewDefinition = async () => {
  const [row] = await sql<{ def: string }[]>`
    select pg_get_viewdef('public.catalog_products'::regclass, true) as def
  `;
  return row.def;
};

describe("تعريف «المعروض» في الكود يطابق العرض في القاعدة", () => {
  test("كل حالة في الثابت مذكورة في تعريف catalog_products", async () => {
    const definition = await viewDefinition();
    for (const status of PUBLICLY_VISIBLE_STATUSES) {
      expect(definition).toContain(`'${status}'`);
    }
  });

  test("شرط العرض لا يقبل حالة خارج الثابت", async () => {
    const definition = await viewDefinition();
    const allStatuses = ["draft", "published", "out_of_stock", "archived"];
    const hidden = allStatuses.filter(
      (status) => !(PUBLICLY_VISIBLE_STATUSES as readonly string[]).includes(status)
    );

    const whereClause = definition.slice(definition.indexOf("WHERE"));
    for (const status of hidden) {
      expect(whereClause).not.toContain(`'${status}'`);
    }
  });
});
