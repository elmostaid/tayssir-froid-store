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

  test("في production حقيقي: يسمح بالمنتجات والتصنيفات والصور والـFeed، ويمنع ما لا يجلب زبوناً", async () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const { default: robots } = await import("@/app/robots");
    const result = robots();

    type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
    const [everyone, nonCustomers] = result.rules as Rule[];

    expect(everyone.userAgent).toBe("*");
    expect(everyone.allow).toBe("/");
    expect(everyone.disallow).toEqual(
      expect.arrayContaining(["/admin", "/api/", "/cart", "/checkout", "/order/", "/search"])
    );
    // ما يحتاجه البحث وإعلانات Meta والكاطالوغ يبقى مفتوحاً.
    for (const open of ["/product/", "/category/", "/img/", "/feed/", "/water-heaters", "/washing-machines"]) {
      expect((everyone.disallow as string[]).some((path) => path === open || open.startsWith(path))).toBe(false);
    }

    expect(nonCustomers.disallow).toBe("/");
    expect(nonCustomers.userAgent).toEqual(expect.arrayContaining(["GPTBot", "Bytespider", "AhrefsBot"]));
    // روبوتات البحث وروبوتات Meta الإعلانية/الكاطالوغ لا تُمنع أبداً.
    for (const allowed of ["Googlebot", "Bingbot", "facebookexternalhit", "facebookcatalog"]) {
      expect(nonCustomers.userAgent).not.toContain(allowed);
    }
  });
});
