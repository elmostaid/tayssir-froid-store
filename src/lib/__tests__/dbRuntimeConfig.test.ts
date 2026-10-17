import { afterEach, describe, expect, test, vi } from "vitest";
import { dbRuntimeConfig } from "@/lib/db";

// الشرط الذي لا يجوز كسره: هذا فرع اختبار، فالقيم بلا أي متغيّر بيئة يجب
// أن تبقى **حرفياً** قيم الإنتاج الحالية — max=5 ومهلة 8000. أي انحراف هنا
// يعني أن دمج الفرع يغيّر سلوك الإنتاج بصمت.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dbRuntimeConfig — الافتراضي هو إعداد الإنتاج نفسه", () => {
  test("بلا متغيّرات بيئة: max=5 ومهلة بدء 8000", () => {
    vi.stubEnv("DB_POOL_MAX", "");
    vi.stubEnv("DB_STATEMENT_TIMEOUT_MS", "");
    const config = dbRuntimeConfig();
    expect(config.poolMax).toBe(5);
    expect(config.statementTimeoutOptionMs).toBe(8000);
    expect(config.connectTimeoutSeconds).toBe(5);
    expect(config.idleTimeoutSeconds).toBe(20);
    expect(config.maxLifetimeSeconds).toBe(1800);
    expect(config.prepare).toBe(false);
  });
});

describe("DB_POOL_MAX", () => {
  test("يقبل 1 و2 — وهما حالتا المقارنة المطلوبة", () => {
    vi.stubEnv("DB_POOL_MAX", "1");
    expect(dbRuntimeConfig().poolMax).toBe(1);
    vi.stubEnv("DB_POOL_MAX", "2");
    expect(dbRuntimeConfig().poolMax).toBe(2);
  });

  test("يرفض الصفر والسالب والعشري والنص ويعود إلى 5", () => {
    for (const bad of ["0", "-1", "2.5", "كثير", "999"]) {
      vi.stubEnv("DB_POOL_MAX", bad);
      expect(dbRuntimeConfig().poolMax).toBe(5);
    }
  });
});

describe("DB_STATEMENT_TIMEOUT_MS", () => {
  test("off يُلغي إرسال معامل البدء كلياً", () => {
    vi.stubEnv("DB_STATEMENT_TIMEOUT_MS", "off");
    expect(dbRuntimeConfig().statementTimeoutOptionMs).toBeNull();
    vi.stubEnv("DB_STATEMENT_TIMEOUT_MS", "OFF");
    expect(dbRuntimeConfig().statementTimeoutOptionMs).toBeNull();
  });

  test("يقبل قيمة صريحة داخل النطاق", () => {
    vi.stubEnv("DB_STATEMENT_TIMEOUT_MS", "1500");
    expect(dbRuntimeConfig().statementTimeoutOptionMs).toBe(1500);
  });

  test("يرفض القيم غير المعقولة ويعود إلى 8000", () => {
    for (const bad of ["10", "500", "999999", "ثمانية"]) {
      vi.stubEnv("DB_STATEMENT_TIMEOUT_MS", bad);
      expect(dbRuntimeConfig().statementTimeoutOptionMs).toBe(8000);
    }
  });
});
