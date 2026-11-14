import { describe, expect, test, vi } from "vitest";

// ⚠️ هذا الاختبار يحرس اكتشافاً من سجلات المعاينة، لا افتراضاً:
// `safeQuery` تُغلِّف البحث في المخزن المؤقّت لا الاستعلام. فعند **تجديد
// الكاش في الخلفية** يُنفِّذ Next الدالة الداخلية من تلقائه خارج أي نداء
// لـsafeQuery — فلو كان الفحص خارجها لما مرّ هذا المسار منه أبداً. وهو
// أخطر مسار في العلّة: الزائر انصرف بصفحته من المخزن، والنسخة تبقى
// محتجزة بعده وحدها حتى سقف 300 ثانية.
//
// فالحرس هنا نصّي عمداً: يتأكّد أن نداء ensureLive يقع **داخل** الدالة
// المُمرَّرة إلى unstable_cache، لا قبلها في مكان آخر. ومحاكاة
// unstable_cache كانت ستُخفي بالضبط ما نريد إثباته.
describe("تجديد الكاش في الخلفية يمرّ من فحص الحيوية", () => {
  test("catalog.ts: ensureLive داخل الدالة المُمرَّرة إلى unstable_cache", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/queries/catalog.ts", "utf8")
    );
    const call = source.slice(source.indexOf("const cached = unstable_cache("));
    const body = call.slice(0, call.indexOf("keyParts,"));
    expect(body).toContain("await dbGuard.ensureLive()");
  });

  test("settings.ts: كذلك", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/queries/settings.ts", "utf8")
    );
    const call = source.slice(source.indexOf("const cachedSettings = unstable_cache("));
    const body = call.slice(0, call.indexOf('["store-settings"]'));
    expect(body).toContain("await dbGuard.ensureLive()");
  });

  test("ولا يوجد unstable_cache ثالث بلا فحص", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync(
      "grep -rln 'unstable_cache(' src --include=*.ts --include=*.tsx | grep -v __tests__ || true"
    )
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(hits.sort()).toEqual([
      "src/lib/queries/catalog.ts",
      "src/lib/queries/settings.ts",
    ]);
  });
});

// الفحص نفسه لا يجوز أن يُسقط تجديداً كان سينجح: ensureLive لا ترمي أبداً.
test("ensureLive لا ترمي ولو فشل إنشاء العميل", async () => {
  const { ConnectionGuard } = await import("@/lib/dbResilience");
  const guard = new ConnectionGuard({
    create: () => {
      throw new Error("لا رابط");
    },
  });
  await expect(guard.ensureLive()).resolves.toMatchObject({ action: "failed" });
  vi.restoreAllMocks();
});
