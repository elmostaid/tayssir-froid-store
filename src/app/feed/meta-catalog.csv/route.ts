import { NextResponse } from "next/server";
import { buildCatalogExport, rowsToCsv } from "@/lib/feed/metaCatalog";

// رابط ثابت وعام: /feed/meta-catalog.csv — يُستعمل مباشرة كمصدر Feed في
// Meta Commerce Manager (Catalog → Data Sources → Scheduled Feed) لتحديث
// الثمن/الصورة/المخزون تلقائياً حسب الجدولة التي يحددها Meta (كل ساعة أو
// يومياً). لا يعرض إلا المنتجات المنشورة فعلاً، وأبداً لا يحوي purchase_price.
export const runtime = "nodejs";

export async function GET() {
  const { rows } = await buildCatalogExport();
  const csv = rowsToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="tayssir-froid-meta-catalog.csv"',
      // يعكس المخزون/الثمن الحاليين مع كاش قصير يكفي لتفادي إعادة البناء
      // في كل طلب من Meta دون أن يُبقي بيانات قديمة طويلاً.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
