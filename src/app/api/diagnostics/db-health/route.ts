import { randomUUID } from "node:crypto";
import { sql, dbGuard, dbRuntimeConfigSnapshot } from "@/lib/db";

/**
 * مسار قياس **مؤقَّت** لاختبار المعاينة — يُحذف بعد انتهاء الاختبارات.
 *
 * ثلاث طبقات رفض مستقلة، كل واحدة تكفي وحدها:
 *   1. حماية Vercel على نشرات المعاينة (مُفعَّلة على هذا المشروع:
 *      ssoProtection.deploymentType = "preview").
 *   2. هذا الحارس: يُرفَض في الإنتاج **ولو وصل إليه طلب مباشر**، ويُرفَض
 *      في أي معاينة غير متّصلة بمشروع Supabase المعزول.
 *   3. رمز في متغيّر بيئة مقصور على فرع المعاينة هذا. غيابه ⇒ رفض.
 *
 * ولا يقبل أي معامل إطلاقاً: لا SQL حرّ، ولا اسم جدول، ولا شيء من
 * المستخدم. ولا يُرجِع أي سرّ: لا كلمة سر ولا رابط اتصال ولا بيانات زبون
 * — أرقاماً وأسماء مضيف ومعرّف مشروع فقط.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ISOLATED_PREVIEW_PROJECT_REF = "zgdjmeigdbgxdxwixnfl";

/** يميّز نسخة الدالة عن أختها: العدّادات لكل نسخة لا للنشر كله. */
const INSTANCE_ID = randomUUID().slice(0, 8);
const INSTANCE_STARTED_AT = Date.now();

function projectRefOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function allowed(request: Request): boolean {
  if (process.env.VERCEL_ENV !== "preview") return false;
  if (projectRefOf(process.env.NEXT_PUBLIC_SUPABASE_URL) !== ISOLATED_PREVIEW_PROJECT_REF) {
    return false;
  }
  const expected = process.env.DB_HEALTH_DIAG_TOKEN?.trim();
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

/** بصمة الاتصال بلا كلمة سر وبلا الرابط كاملاً. */
function fingerprint(): Record<string, unknown> | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const [role, ref] = decodeURIComponent(url.username).split(".");
    return {
      protocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port: url.port ? Number(url.port) : null,
      role: role ?? null,
      projectRef: ref ?? null,
      database: url.pathname.replace(/^\//, ""),
      params: [...url.searchParams.keys()],
      hasPassword: url.password.length > 0,
      pointsAtIsolatedPreview: ref === ISOLATED_PREVIEW_PROJECT_REF,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!allowed(request)) {
    return new Response("Not Found", { status: 404 });
  }

  const [settings] = await sql<
    {
      db_user: string;
      statement_timeout: string;
      transaction_timeout: string | null;
      idle_in_transaction_session_timeout: string;
      backend_pid: number;
      server_version_num: string;
    }[]
  >`
    select
      current_user as db_user,
      current_setting('statement_timeout') as statement_timeout,
      current_setting('transaction_timeout', true) as transaction_timeout,
      current_setting('idle_in_transaction_session_timeout') as idle_in_transaction_session_timeout,
      pg_backend_pid() as backend_pid,
      current_setting('server_version_num') as server_version_num
  `;

  const [pool] = await sql<{ total: string; active: string; idle: string }[]>`
    select
      count(*)::text as total,
      count(*) filter (where state = 'active')::text as active,
      count(*) filter (where state = 'idle')::text as idle
    from pg_stat_activity
    where usename = current_user
  `;

  return Response.json(
    {
      instance: {
        id: INSTANCE_ID,
        upForMs: Date.now() - INSTANCE_STARTED_AT,
        region: process.env.VERCEL_REGION ?? null,
        vercelEnv: process.env.VERCEL_ENV ?? null,
        branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
      connection: fingerprint(),
      runtimeConfig: dbRuntimeConfigSnapshot(),
      guard: dbGuard.stats(),
      serverSettings: settings,
      serverConnections: pool,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
