import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getAdminUser } from "@/lib/auth/requireAdmin";

// بدون NEXT_PUBLIC_SUPABASE_URL/ANON_KEY (وهو وضع الاختبارات/CI الحالي)
// يجب أن تبقى لوحة الإدارة مقفلة بالكامل — لا يوجد أي باب دخول بديل.
describe("getAdminUser — زائر بدون تهيئة Supabase", () => {
  test("يرجع null دائماً عندما لا تكون متغيرات Supabase مضبوطة", async () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeFalsy();
    const admin = await getAdminUser();
    expect(admin).toBeNull();
  });
});

// يحاكي بالضبط عطل Production الحقيقي المؤكَّد من Vercel Runtime Logs:
// auth.getUser() يرمي خطأ شبكة (AbortError عبر fetchWithTimeout عند انتهاء
// مهلة خدمة Supabase Auth) بدل أن يُرجع نتيجة عادية. يجب أن يبقى الدخول
// مرفوضاً تماماً (fail closed) — لا صلاحية، ولا استثناء غير مُعالَج يهرب من
// getAdminUser().
describe("getAdminUser — فشل/انتهاء مهلة Supabase Auth الحقيقي (fail closed)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.doUnmock("@/lib/supabase/server");
    vi.resetModules();
  });

  test("يرجع null (وليس استثناء) عندما يرمي auth.getUser() خطأ شبكة", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: async () => ({
        auth: {
          getUser: async () => {
            throw new DOMException("The operation was aborted.", "AbortError");
          },
        },
      }),
    }));

    const { getAdminUser: getAdminUserFresh } = await import("@/lib/auth/requireAdmin");
    await expect(getAdminUserFresh()).resolves.toBeNull();
  });
});
