import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// يحاكي هذا الاختبار حالة DATABASE_URL معرَّف فعلياً (كما في Vercel) لكن
// الاتصال أو التحقق يفشل وقت التنفيذ (كلمة سر خاطئة، قاعدة متوقفة...) —
// وليس فقط حالة DATABASE_URL غير موجود أصلاً. يتحقق أن getAllProductsForExport
// وgetAllVariantsForExport يرجعان البيانات المحلية الاحتياطية بدل رمي الخطأ،
// حتى لا يسقط Route الخاص بـ/feed/meta-catalog.csv بـ500.

describe("catalogExport: fallback عند فشل الاتصال بقاعدة البيانات (وليس فقط غيابها)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://fake-user:fake-pass@localhost:5432/fake-db");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });

  test("getAllProductsForExport يرجع البيانات المحلية عند فشل مصادقة postgres", async () => {
    vi.doMock("@/lib/db", () => ({
      sql: () => {
        throw new Error('password authentication failed for user "fake-user"');
      },
    }));

    const { getAllProductsForExport } = await import("@/lib/queries/catalogExport");
    const { getAllPreviewProductsForExport } = await import("@/lib/previewCatalog");

    const products = await getAllProductsForExport();
    const expected = getAllPreviewProductsForExport();

    expect(products.length).toBeGreaterThan(0);
    expect(products.length).toBe(expected.length);
    expect(products.map((p) => p.sku)).toEqual(expected.map((p) => p.sku));
  });

  test("getAllVariantsForExport يرجع البيانات المحلية عند فشل مصادقة postgres", async () => {
    vi.doMock("@/lib/db", () => ({
      sql: () => {
        throw new Error('password authentication failed for user "fake-user"');
      },
    }));

    const { getAllVariantsForExport } = await import("@/lib/queries/catalogExport");
    const { getAllPreviewVariantsForExport } = await import("@/lib/previewCatalog");

    const variants = await getAllVariantsForExport();
    const expected = getAllPreviewVariantsForExport();

    expect(variants.length).toBeGreaterThan(0);
    expect(variants.length).toBe(expected.length);
  });

  test("buildCatalogExport (المُستعمل من Route الخاص بـFeed) لا يرمي الخطأ ويرجع نفس عدد صفوف الوضع المحلي", async () => {
    vi.doMock("@/lib/db", () => ({
      sql: () => {
        throw new Error('password authentication failed for user "fake-user"');
      },
    }));

    vi.stubEnv("SITE_URL", "https://example-test-domain.com");

    const { buildCatalogExport } = await import("@/lib/feed/metaCatalog");

    const result = await buildCatalogExport();

    expect(result.totalProducts).toBeGreaterThan(0);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.link.startsWith("https://example-test-domain.com/")).toBe(true);
      expect(row.image_link === "" || row.image_link.startsWith("https://example-test-domain.com/")).toBe(
        true
      );
    }
  });
});
