import { afterEach, describe, expect, test, vi } from "vitest";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  vi.resetModules();
});

// DATABASE_URL موجود لكن مشوَّه الصيغة (مثال حقيقي: مقتطف ناقص من رابط
// اتصال Supabase pooler، بلا "postgres://") — postgres() يرمي TypeError خام
// (ERR_INVALID_URL) فور الإنشاء. عند أول استعلام فعلي، هذا يجب أن يظهر
// كخطأ عربي واضح قابل للفهم بدل استثناء JS خام غير مفهوم.
describe("sql (db.ts) — DATABASE_URL مشوَّه: خطأ عربي واضح عند أول استعلام فعلي", () => {
  test("استدعاء sql فعلياً مع DATABASE_URL مشوَّه يرمي خطأ عربياً واضحاً، وليس TypeError خاماً", async () => {
    process.env.DATABASE_URL = "postgres.vowhaasgwvbbxaxzdtzy";
    vi.resetModules();
    const { sql } = await import("@/lib/db");
    // الرمي متزامن (Proxy الـapply trap يستدعي getClient() فوراً قبل حتى
    // بناء أي Promise)، فليس رفضاً غير متزامن — لا حاجة لـawait/rejects.
    expect(() => sql`select 1`).toThrow(/صيغته غير صالحة/);
  });

  test("DATABASE_URL غير معرَّف إطلاقاً: تبقى نفس رسالة 'غير معرَّف' الأصلية", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { sql } = await import("@/lib/db");
    expect(() => sql`select 1`).toThrow(/غير معرَّف/);
  });
});
