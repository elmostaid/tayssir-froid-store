import { NextResponse } from "next/server";
import { buildCleanCatalogExport, cleanRowsToCsv } from "@/lib/feed/metaCatalogClean";

// رابط ثابت وعام: /meta/catalog.csv — نسخة نظيفة من خلاصة Meta Commerce
// Catalog، مبنية حصرياً من منتجات وصور الموقع الحالية (بلا أي بقايا من
// كتالوج Facebook قديم منفصل). لا يعرض إلا المنتجات المنشورة فعلاً، وأبداً
// لا يحوي purchase_price.
export const runtime = "nodejs";

export async function GET() {
  const { rows } = await buildCleanCatalogExport();
  const csv = cleanRowsToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="tayssir-froid-meta-catalog-clean.csv"',
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
