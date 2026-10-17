import { describe, expect, test } from "vitest";
import {
  ISOLATED_PREVIEW_PROJECT_REF,
  previewOnlyVerdict,
  supabaseProjectRef,
} from "@/lib/diagnostics/previewOnly";

const PREVIEW_URL = `https://${ISOLATED_PREVIEW_PROJECT_REF}.supabase.co`;
const OTHER_URL = "https://vowhaasgwvbbxaxzdtzy.supabase.co";

describe("supabaseProjectRef", () => {
  test("يستخرج معرّف المشروع من الرابط العام", () => {
    expect(supabaseProjectRef(PREVIEW_URL)).toBe(ISOLATED_PREVIEW_PROJECT_REF);
  });

  test("يُرجع null لرابط مشوَّه أو غائب", () => {
    expect(supabaseProjectRef(undefined)).toBeNull();
    expect(supabaseProjectRef("ليس رابطاً")).toBeNull();
  });
});

describe("previewOnlyVerdict — الإنتاج يُرفَض بلا استثناء", () => {
  test("نشر إنتاجي على Vercel يُرفَض حتى لو كان متّصلاً بقاعدة المعاينة", () => {
    const verdict = previewOnlyVerdict({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: PREVIEW_URL,
    });
    expect(verdict.allowed).toBe(false);
  });

  test("بناء إنتاجي خارج Vercel يُرفَض كذلك", () => {
    const verdict = previewOnlyVerdict({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: PREVIEW_URL,
    });
    expect(verdict.allowed).toBe(false);
  });
});

describe("previewOnlyVerdict — المعاينة مسموحة بشرط المشروع المعزول", () => {
  test("معاينة متّصلة بالمشروع المعزول مسموحة", () => {
    const verdict = previewOnlyVerdict({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: PREVIEW_URL,
    });
    expect(verdict).toEqual({ allowed: true, environment: "preview" });
  });

  test("معاينة متّصلة بمشروع آخر تُرفَض — هذا هو القفل الحقيقي", () => {
    const verdict = previewOnlyVerdict({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: OTHER_URL,
    });
    expect(verdict.allowed).toBe(false);
  });

  test("معاينة بلا رابط Supabase تُرفَض", () => {
    const verdict = previewOnlyVerdict({ VERCEL_ENV: "preview" });
    expect(verdict.allowed).toBe(false);
  });

  test("التطوير المحلي مسموح — هناك تُجرَّب القياسات على قاعدة محلية", () => {
    const verdict = previewOnlyVerdict({ NODE_ENV: "test" });
    expect(verdict).toEqual({ allowed: true, environment: "development" });
  });
});
