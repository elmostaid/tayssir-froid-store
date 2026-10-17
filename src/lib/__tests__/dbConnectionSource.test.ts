import { afterEach, describe, expect, test, vi } from "vitest";
import { dbRuntimeConfig } from "@/lib/db";
import { ISOLATED_PREVIEW_PROJECT_REF } from "@/lib/diagnostics/previewOnly";

// الشرط الأمني الذي يحرسه هذا الملف: متغيّر الاختبار
// DATABASE_URL_SESSION_TEST لا يمكن أن يُحوِّل أي نشر إنتاجي إلى قاعدة أخرى.
// الكود نفسه هو الحارس، لا نطاق Vercel — فلو وُجد المتغيّر في الإنتاج يوماً
// يبقى مُتجاهَلاً تماماً.

const PREVIEW_URL = `https://${ISOLATED_PREVIEW_PROJECT_REF}.supabase.co`;
const PRODUCTION_URL = "https://vowhaasgwvbbxaxzdtzy.supabase.co";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("مصدر رابط الاتصال", () => {
  test("بلا متغيّر اختبار: DATABASE_URL دائماً", () => {
    vi.stubEnv("DATABASE_URL_SESSION_TEST", "");
    expect(dbRuntimeConfig().connectionSource).toBe("DATABASE_URL");
  });

  test("في معاينة المشروع المعزول: يُستعمل متغيّر الاختبار", () => {
    vi.stubEnv("DATABASE_URL_SESSION_TEST", "postgres://u@h:5432/d");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PREVIEW_URL);
    expect(dbRuntimeConfig().connectionSource).toBe("DATABASE_URL_SESSION_TEST");
  });

  test("في نشر إنتاجي: يُتجاهَل متغيّر الاختبار ولو كان مضبوطاً", () => {
    vi.stubEnv("DATABASE_URL_SESSION_TEST", "postgres://u@h:5432/d");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PRODUCTION_URL);
    expect(dbRuntimeConfig().connectionSource).toBe("DATABASE_URL");
  });

  test("في معاينة متّصلة بمشروع الإنتاج: يُتجاهَل كذلك", () => {
    vi.stubEnv("DATABASE_URL_SESSION_TEST", "postgres://u@h:5432/d");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PRODUCTION_URL);
    expect(dbRuntimeConfig().connectionSource).toBe("DATABASE_URL");
  });
});
