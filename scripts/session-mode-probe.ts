/**
 * قياس نمطَي اتصال Supavisor — يعمل **وقت البناء** على Vercel.
 *
 * لماذا وقت البناء لا عبر مسار HTTP: مسار التشخيص محميّ بمصادقة المدير (وهو
 * شرط صحيح لا أريد إضعافه)، فقراءته تحتاج جلسة بشرية. أما حاوية البناء على
 * Vercel فتصل إلى المجمّع بنفس بيانات البيئة، فيُنفَّذ القياس من تلقائه مع
 * كل نشر للفرع، وتظهر النتيجة في سجل البناء. بلا أي تدخّل يدوي.
 *
 * وميزة أكبر: يقيس **الرابطين في نفس اللحظة** — منفذ المعاملة 6543 ومنفذ
 * الجلسة 5432 المشتقّ منه في الذاكرة — فتصير المقارنة بين نمطين، لا بين
 * نشرين ولا بين لحظتين ولا بين إصدارين من الكود.
 *
 * حدٌّ صريح: حاوية البناء ليست نسخة خادم (لا تجميد ولا إعادة تسخين)، فهي
 * تُثبِت سلوك المجمّع والمهل والمعاملات، ولا تُثبِت سلوك الاتصال الميت بعد
 * خمول نسخة Serverless. ذاك يبقى لقياس وقت التشغيل.
 *
 * ولا يُفشِل البناء أبداً: كل شيء داخل try، والخروج 0 دائماً.
 * ولا يطبع سرّاً: لا رابط، لا كلمة سر — بصمة الاتصال بلا كلمة السر فقط.
 */
import postgres from "postgres";
import {
  SESSION_MODE_TEST_BRANCH,
  connectionFingerprint,
  deriveSessionModeUrl,
} from "../src/lib/diagnostics/sessionModeUrl";
import { previewOnlyVerdict } from "../src/lib/diagnostics/previewOnly";
import { runSessionModeProbe, type ProbeClient } from "../src/lib/diagnostics/sessionModeProbe";

const POOL_MAX = Number(process.env.DB_POOL_MAX ?? "1") || 1;
const STATEMENT_TIMEOUT_RAW = process.env.DB_STATEMENT_TIMEOUT_MS?.trim().toLowerCase();

function buildClient(connectionString: string): ProbeClient {
  const sendTimeout = STATEMENT_TIMEOUT_RAW !== "off";
  const timeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? "8000") || 8000;
  return postgres(connectionString, {
    max: POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 5,
    max_lifetime: 60 * 30,
    ...(sendTimeout ? { connection: { statement_timeout: timeoutMs } } : {}),
    prepare: false,
  });
}

async function probeOne(label: string, connectionString: string) {
  let client: ProbeClient | null = null;
  try {
    client = buildClient(connectionString);
    const report = await runSessionModeProbe({
      sql: client,
      label,
      includeClientCounters: false,
      includeRuntimeConfig: false,
    });
    return { label, ok: true as const, report };
  } catch (error) {
    return {
      label,
      ok: false as const,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  } finally {
    if (client) {
      try {
        await client.end({ timeout: 5 });
      } catch {
        /* إنهاء المجمّع ليس جزءاً من القياس */
      }
    }
  }
}

async function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (branch !== SESSION_MODE_TEST_BRANCH) {
    console.log(`[session-mode-probe] تخطٍّ: الفرع ${branch ?? "(محلي)"} ليس فرع الاختبار.`);
    return;
  }

  const verdict = previewOnlyVerdict();
  if (!verdict.allowed) {
    console.log(`[session-mode-probe] تخطٍّ: ${verdict.reason}`);
    return;
  }

  const base = process.env.DATABASE_URL;
  if (!base) {
    console.log("[session-mode-probe] تخطٍّ: DATABASE_URL غير معرَّف في بيئة البناء.");
    return;
  }

  let derived: ReturnType<typeof deriveSessionModeUrl>;
  try {
    derived = deriveSessionModeUrl(base);
  } catch (error) {
    // فشل شرط من شروط الاشتقاق: نُعلِنه بوضوح ولا نقيس شيئاً ونُسمّيه
    // نمط الجلسة.
    console.log(
      `[session-mode-probe] توقّف: ${error instanceof Error ? error.message : String(error)}`
    );
    console.log(
      `[session-mode-probe] بصمة الرابط كما هو: ${JSON.stringify(connectionFingerprint(base))}`
    );
    return;
  }

  console.log("[session-mode-probe] === بصمة الاتصال (بلا كلمة سر وبلا الرابط) ===");
  console.log(`[session-mode-probe] قبل: ${JSON.stringify(derived.before)}`);
  console.log(`[session-mode-probe] بعد: ${JSON.stringify(derived.after)}`);
  console.log(
    `[session-mode-probe] حُذفت pgbouncer=true: ${derived.removedPgbouncerFlag} | كان على منفذ الجلسة أصلاً: ${derived.alreadySessionMode}`
  );
  console.log(
    `[session-mode-probe] إعداد القياس: max=${POOL_MAX} statement_timeout_option=${
      STATEMENT_TIMEOUT_RAW === "off" ? "off" : process.env.DB_STATEMENT_TIMEOUT_MS ?? "8000"
    }`
  );

  const runs = [];
  // نمط المعاملة أولاً (الرابط كما هو في Vercel)، ثم نمط الجلسة المشتقّ.
  if (!derived.alreadySessionMode) {
    runs.push(await probeOne("transaction-mode-6543", base));
  }
  runs.push(await probeOne("session-mode-5432", derived.url));

  for (const run of runs) {
    console.log(`[session-mode-probe] === ${run.label} ===`);
    console.log(`[session-mode-probe] ${JSON.stringify(run)}`);
  }

  // وتُحفَظ النتيجة في جدول على قاعدة المعاينة أيضاً، لا في سجل البناء
  // وحده: سجلات البناء تُقرأ سطراً سطراً ويضيع فيها الجوهر بين تحذيرات
  // npm، أما الصفّ فيُستعلَم مرة واحدة ويبقى للمقارنة بين الجولات.
  // الكتابة عبر الرابط الأصلي (نمط المعاملة) لأنه المعروف أنه يعمل — فلو
  // فشل نمط الجلسة كلياً يبقى سجل فشله محفوظاً.
  const recorder = buildClient(base);
  try {
    for (const run of runs) {
      await recorder`
        insert into public.diag_runs (commit_sha, label, payload)
        values (
          ${process.env.VERCEL_GIT_COMMIT_SHA ?? null},
          ${run.label},
          ${recorder.json({
            poolMax: POOL_MAX,
            statementTimeoutOption:
              STATEMENT_TIMEOUT_RAW === "off" ? "off" : process.env.DB_STATEMENT_TIMEOUT_MS ?? "8000",
            fingerprintBefore: derived.before,
            fingerprintAfter: derived.after,
            removedPgbouncerFlag: derived.removedPgbouncerFlag,
            run,
          })}
        )
      `;
    }
    console.log(`[session-mode-probe] حُفظت ${runs.length} نتيجة في public.diag_runs`);
  } catch (error) {
    console.log(
      `[session-mode-probe] تعذّر حفظ النتائج: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    try {
      await recorder.end({ timeout: 5 });
    } catch {
      /* لا يهمّ */
    }
  }
}

main()
  .catch((error) => {
    console.log(
      `[session-mode-probe] خطأ غير متوقَّع (لا يُفشِل البناء): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  })
  .finally(() => {
    process.exit(0);
  });
