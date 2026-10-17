import {
  ISOLATED_PREVIEW_PROJECT_REF,
  previewOnlyVerdict,
  type DiagnosticsEnv,
} from "@/lib/diagnostics/previewOnly";

/**
 * اشتقاق رابط «نمط الجلسة» من رابط المعاينة الموجود أصلاً، في ذاكرة
 * التطبيق وحدها.
 *
 * الأساس التقني: مجمّع Supabase المشترك يقدّم النمطين على **نفس المضيف
 * وبنفس بيانات الدخول**، والمنفذ هو ما يختار النمط — 6543 للمعاملة و5432
 * للجلسة. فلا حاجة لرابط ثانٍ ولا لكلمة سر ثانية: نفس القيمة، منفذ مختلف.
 *
 * ولا تُلمَس قيمة المتغيّر في Vercel إطلاقاً: نقرأها، نبني منها URL جديداً
 * في الذاكرة، ونستعمله لهذا النشر وحده.
 *
 * وكل شرط يُفحَص قبل الاستعمال، وفشل أيٍّ منها يرمي خطأً واضحاً — لا اتصال
 * بديل بصمت، ولا رجوع هادئ إلى النمط القديم يجعلنا نقيس شيئاً ونُسمّيه
 * شيئاً آخر:
 *
 *   • البروتوكول postgres، والمضيف من مجمّع Supabase المشترك.
 *   • اسم المستخدم بصيغة `<role>.<project-ref>` التي يفرضها Supavisor.
 *   • ومعرّف المشروع **هو** مشروع المعاينة المعزول بعينه.
 *   • والمنفذ معروف صراحةً (6543 أو 5432) — لا نفترض منفذاً غائباً.
 *
 * وتُحذَف `pgbouncer=true` من الرابط المشتقّ إن وُجدت: هي راية خاصة بنمط
 * المعاملة، ولا معنى لها على منفذ الجلسة.
 */

export const SESSION_MODE_TEST_BRANCH = "test/session-mode-5432";
export const TRANSACTION_POOLER_PORT = 6543;
export const SESSION_POOLER_PORT = 5432;

const SUPAVISOR_HOST_SUFFIX = ".pooler.supabase.com";
/** Supavisor يشترط `<role>.<ref>` في اسم المستخدم. */
const POOLER_USERNAME = /^([A-Za-z_][A-Za-z0-9_]*)\.([a-z]{16,24})$/;

/**
 * بصمة الاتصال: ما يكفي للتحقّق من الهوية، **بلا كلمة السر وبلا الرابط
 * كاملاً**. أسماء معاملات الاستعلام فقط دون قيمها.
 */
export type ConnectionFingerprint = {
  protocol: string;
  host: string;
  port: number | null;
  role: string | null;
  projectRef: string | null;
  database: string;
  paramNames: string[];
  hasPassword: boolean;
};

export function connectionFingerprint(raw: string): ConnectionFingerprint | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const username = decodeURIComponent(parsed.username);
  const match = POOLER_USERNAME.exec(username);
  return {
    protocol: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : null,
    role: match ? match[1] : username || null,
    projectRef: match ? match[2] : null,
    database: parsed.pathname.replace(/^\//, ""),
    paramNames: [...parsed.searchParams.keys()].sort(),
    hasPassword: parsed.password !== "",
  };
}

export type DerivedSessionUrl = {
  url: string;
  before: ConnectionFingerprint;
  after: ConnectionFingerprint;
  removedPgbouncerFlag: boolean;
  alreadySessionMode: boolean;
};

export class SessionModeDerivationError extends Error {
  constructor(reason: string) {
    super(`تعذّر اشتقاق رابط نمط الجلسة: ${reason}`);
    this.name = "SessionModeDerivationError";
  }
}

export function deriveSessionModeUrl(raw: string): DerivedSessionUrl {
  const before = connectionFingerprint(raw);
  if (!before) throw new SessionModeDerivationError("القيمة ليست رابط اتصال صالحاً.");

  if (before.protocol !== "postgres" && before.protocol !== "postgresql") {
    throw new SessionModeDerivationError(`بروتوكول غير متوقَّع (${before.protocol}).`);
  }
  if (!before.host.endsWith(SUPAVISOR_HOST_SUFFIX)) {
    throw new SessionModeDerivationError(
      "المضيف ليس مجمّع Supabase المشترك، فالمنفذ 5432 عليه لا يعني نمط الجلسة."
    );
  }
  if (before.projectRef === null) {
    throw new SessionModeDerivationError(
      "اسم المستخدم ليس بصيغة <role>.<project-ref> التي يفرضها Supavisor."
    );
  }
  if (before.projectRef !== ISOLATED_PREVIEW_PROJECT_REF) {
    throw new SessionModeDerivationError(
      "معرّف المشروع في الرابط ليس مشروع المعاينة المعزول."
    );
  }
  if (before.port !== TRANSACTION_POOLER_PORT && before.port !== SESSION_POOLER_PORT) {
    throw new SessionModeDerivationError(
      `منفذ غير معروف (${before.port ?? "غائب"}) — لا نفترض منفذاً.`
    );
  }

  const parsed = new URL(raw);
  const removedPgbouncerFlag = parsed.searchParams.has("pgbouncer");
  parsed.searchParams.delete("pgbouncer");
  const alreadySessionMode = before.port === SESSION_POOLER_PORT;
  parsed.port = String(SESSION_POOLER_PORT);

  const url = parsed.toString();
  const after = connectionFingerprint(url);
  if (!after) throw new SessionModeDerivationError("الرابط المشتقّ غير صالح.");

  return { url, before, after, removedPgbouncerFlag, alreadySessionMode };
}

export type SessionModeSwitch =
  | { enabled: true; branch: string }
  | { enabled: false; reason: string };

/**
 * متى يُفعَّل الاشتقاق؟ ثلاثة شروط مجتمعة، ولا رابعة:
 * نشر معاينة (لا إنتاج)، على الفرع المحدَّد بعينه، ومتّصل بمشروع المعاينة
 * المعزول. ويبقى `DB_SESSION_MODE=off` مخرجاً صريحاً لقياس نمط المعاملة
 * على **نفس الكود** — فتصير المقارنة بين نمطين لا بين إصدارين.
 */
export function sessionModeSwitch(
  env: DiagnosticsEnv & { VERCEL_GIT_COMMIT_REF?: string; DB_SESSION_MODE?: string } = process.env
): SessionModeSwitch {
  if (env.DB_SESSION_MODE?.trim().toLowerCase() === "off") {
    return { enabled: false, reason: "مُطفأ صراحةً بـDB_SESSION_MODE=off" };
  }
  const branch = env.VERCEL_GIT_COMMIT_REF;
  if (branch !== SESSION_MODE_TEST_BRANCH) {
    return { enabled: false, reason: `ليس فرع الاختبار (${branch ?? "لا فرع"})` };
  }
  const verdict = previewOnlyVerdict(env);
  if (!verdict.allowed) {
    return { enabled: false, reason: verdict.reason };
  }
  return { enabled: true, branch };
}
