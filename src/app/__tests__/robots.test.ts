import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// robots.ts يقرأ VERCEL_ENV مباشرة عند كل استدعاء (عبر isProductionDeployment())،
// لذا لا حاجة لإعادة استيراد الوحدة بين الاختبارات — فقط ضبط/إزالة متغيّر البيئة.

describe("robots()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("في Preview (أو أي بيئة غير production): يمنع الفهرسة العامة لكن يسمح تحديداً بصور المنتجات وصفحات المنتج وFeed", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    const { default: robots } = await import("@/app/robots");
    const result = robots();

    expect(Array.isArray(result.rules)).toBe(false);
    const rule = result.rules as { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };

    expect(rule.userAgent).toBe("*");
    expect(rule.disallow).toBe("/");
    expect(rule.allow).toEqual(["/product-images/", "/product/", "/feed/"]);
  });

  test("في production حقيقي: يسمح بكل شيء ما عدا /admin", async () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const { default: robots } = await import("@/app/robots");
    const result = robots();

    const rule = result.rules as { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(["/admin"]);
  });
});
