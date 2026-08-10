import { NextResponse } from "next/server";
import { buildMetaFeed, metaFeedRowsToCsv } from "@/lib/feed/metaFeed";

// رابط ثابت وعام: /api/meta-feed.csv — خلاصة Meta/WhatsApp Catalog ديناميكية
// مبنية مباشرة من public.catalog_products (قاعدة بيانات الإنتاج الحقيقية)
// عند كل طلب، وليست ملفاً ثابتاً مُولَّداً يدوياً. لا تعرض إلا المنتجات
// المنشورة فعلاً (الـview نفسها تستبعد الباقي)، وأبداً لا تحوي purchase_price
// أو أي بيانات إدارية داخلية.
export const runtime = "nodejs";

export async function GET() {
  const { rows } = await buildMetaFeed();
  const csv = metaFeedRowsToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="tayssir-froid-meta-feed.csv"',
      // كاش قصير: يعكس الثمن/المخزون الحاليين بسرعة معقولة دون إعادة بناء
      // الخلاصة بأكملها فكل طلب فردي من Meta/WhatsApp.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
