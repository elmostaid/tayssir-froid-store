import { describe, expect, test } from "vitest";
import {
  SESSION_MODE_TEST_BRANCH,
  connectionFingerprint,
  deriveSessionModeUrl,
  sessionModeSwitch,
} from "@/lib/diagnostics/sessionModeUrl";
import { ISOLATED_PREVIEW_PROJECT_REF } from "@/lib/diagnostics/previewOnly";

const PREVIEW_URL = `https://${ISOLATED_PREVIEW_PROJECT_REF}.supabase.co`;
const HOST = "aws-0-eu-north-1.pooler.supabase.com";
// كلمة سر مُلفَّقة للاختبار، لا علاقة لها بأي قيمة حقيقية.
const TRANSACTION = `postgres://postgres.${ISOLATED_PREVIEW_PROJECT_REF}:fake-pw@${HOST}:6543/postgres?pgbouncer=true`;

describe("connectionFingerprint — يتحقّق بلا كشف", () => {
  test("يفكّك المضيف والمنفذ والدور ومعرّف المشروع", () => {
    const fp = connectionFingerprint(TRANSACTION)!;
    expect(fp).toMatchObject({
      protocol: "postgres",
      host: HOST,
      port: 6543,
      role: "postgres",
      projectRef: ISOLATED_PREVIEW_PROJECT_REF,
      database: "postgres",
      paramNames: ["pgbouncer"],
      hasPassword: true,
    });
  });

  test("لا تظهر كلمة السر في البصمة إطلاقاً", () => {
    expect(JSON.stringify(connectionFingerprint(TRANSACTION))).not.toContain("fake-pw");
  });
});

describe("deriveSessionModeUrl", () => {
  test("يبدّل 6543 بـ5432 ويحذف pgbouncer=true ويحفظ بقية الرابط", () => {
    const derived = deriveSessionModeUrl(TRANSACTION);
    expect(derived.before.port).toBe(6543);
    expect(derived.after.port).toBe(5432);
    expect(derived.removedPgbouncerFlag).toBe(true);
    expect(derived.after.paramNames).toEqual([]);
    expect(derived.alreadySessionMode).toBe(false);
    // نفس المضيف ونفس الدور ونفس المشروع ونفس كلمة السر — المنفذ وحده تغيّر.
    expect(derived.after.host).toBe(HOST);
    expect(derived.after.role).toBe("postgres");
    expect(derived.after.projectRef).toBe(ISOLATED_PREVIEW_PROJECT_REF);
    expect(derived.url).toContain(":5432/");
    expect(derived.url).not.toContain("pgbouncer");
  });

  test("رابط على منفذ الجلسة أصلاً يُقبَل ويُعلَّم كذلك", () => {
    const already = TRANSACTION.replace(":6543", ":5432");
    const derived = deriveSessionModeUrl(already);
    expect(derived.alreadySessionMode).toBe(true);
    expect(derived.after.port).toBe(5432);
  });
});

describe("deriveSessionModeUrl — كل شرط يفشل يرمي خطأً واضحاً", () => {
  test("مضيف ليس مجمّع Supabase", () => {
    expect(() =>
      deriveSessionModeUrl(`postgres://postgres.${ISOLATED_PREVIEW_PROJECT_REF}:p@db.example.com:6543/postgres`)
    ).toThrow(/مجمّع Supabase المشترك/);
  });

  test("معرّف مشروع آخر — ولو كان مضيف المجمّع صحيحاً", () => {
    expect(() =>
      deriveSessionModeUrl(`postgres://postgres.vowhaasgwvbbxaxzdtzy:p@${HOST}:6543/postgres`)
    ).toThrow(/مشروع المعاينة المعزول/);
  });

  test("اسم مستخدم بلا صيغة <role>.<ref>", () => {
    expect(() => deriveSessionModeUrl(`postgres://postgres:p@${HOST}:6543/postgres`)).toThrow(
      /<role>\.<project-ref>/
    );
  });

  test("منفذ غائب أو غير معروف — لا نفترض", () => {
    expect(() =>
      deriveSessionModeUrl(`postgres://postgres.${ISOLATED_PREVIEW_PROJECT_REF}:p@${HOST}/postgres`)
    ).toThrow(/لا نفترض منفذاً/);
    expect(() =>
      deriveSessionModeUrl(`postgres://postgres.${ISOLATED_PREVIEW_PROJECT_REF}:p@${HOST}:7777/postgres`)
    ).toThrow(/لا نفترض منفذاً/);
  });

  test("قيمة ليست رابطاً", () => {
    expect(() => deriveSessionModeUrl("ليس رابطاً")).toThrow(/ليست رابط اتصال صالحاً/);
  });

  test("بروتوكول آخر", () => {
    expect(() =>
      deriveSessionModeUrl(`mysql://postgres.${ISOLATED_PREVIEW_PROJECT_REF}:p@${HOST}:6543/postgres`)
    ).toThrow(/بروتوكول غير متوقَّع/);
  });
});

describe("sessionModeSwitch — ثلاثة شروط مجتمعة", () => {
  const enabledEnv = {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: SESSION_MODE_TEST_BRANCH,
    NEXT_PUBLIC_SUPABASE_URL: PREVIEW_URL,
  };

  test("معاينة + فرع الاختبار + المشروع المعزول → مُفعَّل", () => {
    expect(sessionModeSwitch(enabledEnv)).toEqual({
      enabled: true,
      branch: SESSION_MODE_TEST_BRANCH,
    });
  });

  test("فرع آخر → مُطفأ", () => {
    expect(
      sessionModeSwitch({ ...enabledEnv, VERCEL_GIT_COMMIT_REF: "main" }).enabled
    ).toBe(false);
  });

  test("نشر إنتاجي → مُطفأ ولو كان الفرع هو فرع الاختبار", () => {
    expect(
      sessionModeSwitch({ ...enabledEnv, VERCEL_ENV: "production" }).enabled
    ).toBe(false);
  });

  test("معاينة متّصلة بمشروع الإنتاج → مُطفأ", () => {
    expect(
      sessionModeSwitch({
        ...enabledEnv,
        NEXT_PUBLIC_SUPABASE_URL: "https://vowhaasgwvbbxaxzdtzy.supabase.co",
      }).enabled
    ).toBe(false);
  });

  test("DB_SESSION_MODE=off → مُطفأ صراحةً، لقياس نمط المعاملة على نفس الكود", () => {
    expect(sessionModeSwitch({ ...enabledEnv, DB_SESSION_MODE: "off" }).enabled).toBe(false);
  });

  test("محلياً بلا فرع Vercel → مُطفأ", () => {
    expect(sessionModeSwitch({ NODE_ENV: "test" }).enabled).toBe(false);
  });
});
