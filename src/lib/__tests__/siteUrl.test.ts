import { afterEach, describe, expect, test, vi } from "vitest";

async function loadSiteUrl() {
  vi.resetModules();
  return import("@/lib/siteUrl");
}

describe("getSiteUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("SITE_URL غير مضبوط إطلاقاً -> null (بلا أي رابط مخترَع)", async () => {
    vi.stubEnv("SITE_URL", "");
    const { getSiteUrl } = await loadSiteUrl();
    expect(getSiteUrl()).toBeNull();
  });

  test("SITE_URL صحيح -> يُرجَع كما هو (بلا شرطة مائلة زائدة فالنهاية)", async () => {
    vi.stubEnv("SITE_URL", "https://www.tayssirfroid.com/");
    const { getSiteUrl } = await loadSiteUrl();
    expect(getSiteUrl()).toBe("https://www.tayssirfroid.com");
  });

  // هذا الاختبار يحمي بالضبط العطل الحقيقي المُكتشَف فـProduction: SITE_URL
  // مضبوط فعلياً (وليس فارغاً) بقيمة لا تصلح كرابط (مقطع من رابط قاعدة
  // بيانات مصدره خارج هذا المستودع) — new URL() فـlayout.tsx كانت سترمي
  // استثناءً يُسقِط next build بأكمله. الآن يجب أن تُرجع رابطاً احتياطياً
  // ثابتاً بدل ذلك، بلا أي استثناء يخرج من الدالة إطلاقاً.
  test("SITE_URL مضبوط بقيمة غير صالحة كرابط (مثال حقيقي: مقطع من رابط قاعدة بيانات) -> رابط احتياطي ثابت، بلا رمي أي استثناء", async () => {
    vi.stubEnv("SITE_URL", "postgres.wowhaasgwbibxazcdtzy");
    const { getSiteUrl } = await loadSiteUrl();
    expect(() => getSiteUrl()).not.toThrow();
    expect(getSiteUrl()).toBe("https://www.tayssirfroid.com");
  });

  test("SITE_URL مضبوط بقيمة غير صالحة أخرى (بلا http(s)://) -> نفس الرابط الاحتياطي", async () => {
    vi.stubEnv("SITE_URL", "not a real url at all");
    const { getSiteUrl } = await loadSiteUrl();
    expect(getSiteUrl()).toBe("https://www.tayssirfroid.com");
  });

  // يضمن أن السطر الوحيد فكل المشروع الذي يستدعي new URL(siteUrl) مباشرة
  // (src/app/layout.tsx) لن يتلقى أبداً قيمة غير صالحة بعد هذا الإصلاح —
  // القيمة المُرجَعة (سواء الحقيقية أو الاحتياطية) صالحة دائماً كوسيط لـnew URL().
  test("القيمة المُرجَعة (فكل الحالات غير null) تبقى دائماً قابلة للتمرير مباشرة إلى new URL() بلا استثناء", async () => {
    for (const raw of [
      "https://www.tayssirfroid.com",
      "postgres.wowhaasgwbibxazcdtzy",
      "not a real url at all",
      "https://valid-example.com/",
    ]) {
      vi.stubEnv("SITE_URL", raw);
      const { getSiteUrl } = await loadSiteUrl();
      const value = getSiteUrl();
      expect(value).not.toBeNull();
      expect(() => new URL(value as string)).not.toThrow();
    }
  });
});
