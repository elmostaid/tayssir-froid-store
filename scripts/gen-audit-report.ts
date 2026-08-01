import { writeFileSync } from "node:fs";
import { buildCatalogExport, type AuditIssue } from "@/lib/feed/metaCatalog";

async function main() {
  const result = await buildCatalogExport();
  console.log("total products:", result.totalProducts);
  console.log("excluded from feed:", result.excludedFromFeed);
  console.log("rows in feed:", result.rows.length);
  console.log("issues found:", result.issues.length);

  const cols: (keyof AuditIssue)[] = [
    "sku",
    "name_ar",
    "category_name_ar",
    "issue_type",
    "severity",
    "included_in_feed",
    "detail",
  ];
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [cols.join(",")];
  for (const issue of result.issues) {
    lines.push(cols.map((c) => esc(String(issue[c]))).join(","));
  }
  writeFileSync("meta_catalog_audit_report.csv", lines.join("\r\n") + "\r\n", "utf-8");
  console.log("written meta_catalog_audit_report.csv");
}

main();
