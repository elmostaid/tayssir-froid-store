import { afterEach, describe, expect, test, vi } from "vitest";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  vi.resetModules();
});

// عطل إنتاج حقيقي: adminReports.ts كان يحسب جزء SQL قابل لإعادة الاستعمال
// (ORDER_COGS_CTE) على مستوى الوحدة (module scope) بدل داخل دالة. sql`...`
// يستدعي getClient() فوراً بمجرد التنفيذ (راجع db.ts — Proxy الـapply
// trap)، فمجرد "import" هذا الملف — يحدث حتماً أثناء "Collecting page
// data" فـnext build لأي صفحة تستورده (/admin/reports) — كان يفتح/يتحقق من
// DATABASE_URL وقت البناء لا وقت التشغيل، فيُسقط build الموقع بأكمله لو
// كانت قيمته مشوَّهة فبيئة واحدة (Preview) فقط — رغم عدم استدعاء أي دالة
// استعلام هنا فعلياً. الاستيراد وحده يجب أن يبقى بلا أي أثر جانبي، بغض
// النظر عن DATABASE_URL.
describe("adminReports.ts — الاستيراد وحده لا يلمس DATABASE_URL إطلاقاً (بلا أي استعلام حقيقي)", () => {
  test("استيراد الوحدة ينجح حتى مع DATABASE_URL مشوَّه تماماً (نفس القيمة الحقيقية من عطل الإنتاج)", async () => {
    process.env.DATABASE_URL = "postgres.vowhaasgwvbbxaxzdtzy";
    vi.resetModules();
    await expect(import("@/lib/queries/adminReports")).resolves.toBeDefined();
  });

  test("استيراد الوحدة ينجح حتى بلا DATABASE_URL إطلاقاً", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    await expect(import("@/lib/queries/adminReports")).resolves.toBeDefined();
  });
});
