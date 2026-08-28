import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// حارس على ملف الهجرة نفسه: الشرط الأول والأهم في هذه الميزة هو ألا يتغيّر
// أي منتج حالي ولا أي طلب قديم تلقائياً. اختبار نصي بسيط، لكنه يمنع أن
// تتسلل يوماً جملة UPDATE أو backfill إلى هذه الهجرة بعد مراجعتها.
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260828000000_product_tier_pricing.sql"
);

const sql = readFileSync(MIGRATION_PATH, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("هجرة التسعير المتدرِّج — إضافية بحتة", () => {
  it("لا تحتوي أي UPDATE", () => {
    expect(statements).not.toMatch(/\bupdate\s+public\./);
  });

  it("لا تحتوي أي INSERT (لا backfill ولا بيانات مُعبَّأة تلقائياً)", () => {
    expect(statements).not.toMatch(/\binsert\s+into\b/);
  });

  it("لا تحتوي أي DELETE أو DROP على جدول", () => {
    expect(statements).not.toMatch(/\bdelete\s+from\b/);
    expect(statements).not.toMatch(/\bdrop\s+table\b/);
    expect(statements).not.toMatch(/\bdrop\s+column\b/);
  });

  it("لا تمسّ order_items ولا orders إطلاقاً — الطلبات القديمة مجمَّدة", () => {
    expect(statements).not.toContain("order_items");
    expect(statements).not.toContain("public.orders");
  });

  it("لا تمسّ sale_price ولا min_order_qty الموجودَين", () => {
    expect(statements).not.toMatch(/alter\s+column\s+sale_price/);
    expect(statements).not.toMatch(/alter\s+column\s+min_order_qty/);
    expect(statements).not.toMatch(/set\s+default[^;]*min_order_qty/);
  });

  it("النمط الافتراضي هو single — كل منتج حالي يبقى بثمن واحد", () => {
    expect(statements).toContain("pricing_mode text not null default 'single'");
  });

  it("رابط واتساب للكميات الكبيرة مُطفأ افتراضياً", () => {
    expect(statements).toContain("show_bulk_whatsapp boolean not null default false");
  });

  it("قيد التماسك موجود ويغطي الأنماط الثلاثة", () => {
    expect(statements).toContain("products_pricing_mode_coherent");
    expect(statements).toContain("tier3_min_qty > tier2_min_qty");
  });

  it("الـviews العامة لا تكشف ثمن الشراء السري", () => {
    const viewSection = statements.slice(statements.indexOf("create or replace view"));
    expect(viewSection).not.toContain("purchase_price");
  });
});
