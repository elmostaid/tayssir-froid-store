import { sql } from "@/lib/db";
import { buildMetaFeed, metaFeedRowsToCsv } from "@/lib/feed/metaFeed";

async function main() {
  const [{ count: totalInDb }] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.products
  `;
  const [{ count: totalCatalog }] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.catalog_products
  `;

  const result = await buildMetaFeed();
  const csv = metaFeedRowsToCsv(result.rows);

  // فحص شكل الرابط (يجب أن يبدأ حصراً بدومين الإنتاج، بلا localhost/preview)
  // — هذا أقصى فحص فعلي ممكن من هذه البيئة تحديداً: طلبات HTTP فعلية نحو
  // www.tayssirfroid.com محجوبة من هذا الـsandbox (egress policy)، فلا يمكن
  // تنفيذ فحص "الرابط يرجع صورة فعلية حقاً" هنا حرفياً.
  let malformedLinks = 0;
  const malformedList: string[] = [];
  for (const row of result.rows) {
    for (const url of [row.link, row.image_link]) {
      if (!url.startsWith("https://www.tayssirfroid.com/")) {
        malformedLinks++;
        malformedList.push(url);
      }
    }
  }

  const ids = result.rows.map((r) => r.id);
  const duplicateIdsInCsv = ids.length - new Set(ids).size;
  const rowsWithoutImage = result.rows.filter((r) => !r.image_link).length;

  console.log("=== Meta Feed Validation Report ===");
  console.log("DB connection:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"));
  console.log("Products in DB (all statuses):", totalInDb);
  console.log("catalog_products (published + active category):", totalCatalog);
  console.log("Feed rows (included):", result.includedCount);
  console.log("Excluded — no image:", result.excludedNoImageCount, result.excludedNoImageSkus);
  console.log("Duplicate SKUs found while scanning:", result.duplicateSkus.length, result.duplicateSkus);
  console.log("Duplicate ids in final CSV rows:", duplicateIdsInCsv);
  console.log("Rows with empty image_link:", rowsWithoutImage);
  console.log("Malformed links (not https://www.tayssirfroid.com/...):", malformedLinks, malformedList);
  console.log("");
  console.log("=== First 5 CSV lines ===");
  console.log(csv.split("\r\n").slice(0, 6).join("\n"));

  process.exit(0);
}

main().catch((err) => {
  console.error("VALIDATION FAILED:", err);
  process.exit(1);
});
