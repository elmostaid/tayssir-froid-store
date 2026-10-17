import { sql } from "@/lib/db";
import { dbRuntimeConfig, dbQueryCounters } from "@/lib/db";

/**
 * قياسات نمط الاتصال على قاعدة المعاينة المعزولة — كل استعلام هنا **نصّ
 * ثابت مكتوب في الكود**. لا يقبل هذا الملف أي SQL من طلب المستخدم، ولا أي
 * معامل يُركَّب داخل استعلام؛ فلا سطح هجوم للحقن أصلاً، لا «منقَّى» بل غير
 * موجود.
 *
 * وما يخرج منه أرقام وحالات فقط: مهل، أزمنة، رموز أخطاء، أعداد اتصالات،
 * ومعرّف عملية الخادم. لا رابط قاعدة بيانات، لا كلمة سر، ولا صفّ واحد من
 * بيانات الزبناء.
 */

/** جدول فحص صغير يُنشأ على قاعدة المعاينة وحدها، وليس في أي migration. */
const PROBE_TABLE = "diag_probe";

/** أطول من statement_timeout المقترح (8s) بما يكفي ليُثبِت أنه يعمل. */
const LONG_SLEEP_SECONDS = 12;

/** شبكة أمان: لا يُسمح لأي خطوة بأن تُعلِّق الطلب إلى الأبد. */
const STEP_GUARD_MS = 25000;

/** تمييز الجلسة في اكتشاف نمط المجمّع — قيمة لا يضبطها أي شيء آخر. */
const PROBE_TIMEOUT_MARKER = "3777ms";

const GUARD = Symbol("step-guard");

export type StepError = {
  code: string | null;
  name: string | null;
  severity: string | null;
  routine: string | null;
  /** هل جاء الإلغاء من الخادم فعلاً (وليس مُلفَّقاً من العميل)؟ */
  fromServer: boolean;
};

function describeError(error: unknown): StepError {
  const candidate = error as Record<string, unknown> | null;
  const read = (key: string): string | null => {
    const value = candidate?.[key];
    return typeof value === "string" ? value : null;
  };
  // postgres.js يُلفِّق 57014 من جهة العميل عند إلغاء استعلام ما زال في
  // الطابور — وذلك الخطأ المُلفَّق بلا severity/routine. فحضورهما هو الفرق
  // بين «الخادم أوقف الاستعلام» و«العميل تخلّى عنه».
  const severity = read("severity");
  const routine = read("routine");
  return {
    code: read("code"),
    name: read("name"),
    severity,
    routine,
    fromServer: Boolean(severity && routine),
  };
}

async function withGuard<T>(
  label: string,
  run: () => Promise<T>
): Promise<{ value: T | null; elapsedMs: number; error: StepError | null; guardFired: boolean }> {
  const startedAt = Date.now();
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<typeof GUARD>((resolve) => {
    guardTimer = setTimeout(() => resolve(GUARD), STEP_GUARD_MS);
  });

  try {
    const outcome = await Promise.race([run(), guard]);
    if (outcome === GUARD) {
      return {
        value: null,
        elapsedMs: Date.now() - startedAt,
        error: { code: null, name: `guard:${label}`, severity: null, routine: null, fromServer: false },
        guardFired: true,
      };
    }
    return { value: outcome as T, elapsedMs: Date.now() - startedAt, error: null, guardFired: false };
  } catch (error) {
    return {
      value: null,
      elapsedMs: Date.now() - startedAt,
      error: describeError(error),
      guardFired: false,
    };
  } finally {
    if (guardTimer) clearTimeout(guardTimer);
  }
}

type SettingsRow = {
  statement_timeout: string | null;
  /** أُضيف في PostgreSQL 17 — null على إصدار أقدم (قاعدة الاختبار المحلية). */
  transaction_timeout: string | null;
  idle_in_transaction_session_timeout: string | null;
  db_user: string;
  server_version_num: string;
  backend_pid: number;
  backend_started_at: string;
  seconds_since_backend_start: number;
};

/** ما يراه التطبيق فعلاً على اتصاله الحقيقي — لا ما نظنّه. */
async function readServerSettings() {
  return withGuard("settings", async () => {
    const rows = await sql<SettingsRow[]>`
      select
        -- الوسيط الثاني (missing_ok) يُرجع null بدل أن يرمي خطأً لمعامل غير
        -- معروف: transaction_timeout أُضيف في PostgreSQL 17، وقاعدة
        -- الاختبار المحلية على 16 — فبلا هذا الوسيط يسقط الاستعلام كله
        -- محلياً ويضيع معه كل قياس آخر في نفس الصفّ.
        current_setting('statement_timeout', true)                   as statement_timeout,
        current_setting('transaction_timeout', true)                 as transaction_timeout,
        current_setting('idle_in_transaction_session_timeout', true) as idle_in_transaction_session_timeout,
        current_user                                             as db_user,
        current_setting('server_version_num')                        as server_version_num,
        pg_backend_pid()                                         as backend_pid,
        (select backend_start from pg_stat_activity where pid = pg_backend_pid()) as backend_started_at,
        (extract(epoch from (now() - (select backend_start from pg_stat_activity where pid = pg_backend_pid()))))::int
                                                                 as seconds_since_backend_start
    `;
    return rows[0] ?? null;
  });
}

/**
 * نمط الجلسة أم نمط المعاملة؟ اختبارٌ لا تخمين: نضبط قيمة مميَّزة على
 * مستوى الجلسة في استعلام، ثم نقرأها في استعلام **منفصل**. بقاؤها يعني أن
 * حالة الجلسة محفوظة — وهو ما يُميّز نمط الجلسة؛ واختفاؤها يعني أن المجمّع
 * بدّل الخادم خلفنا، وهو سلوك نمط المعاملة. يصحّ الاستنتاج بثقة عند
 * max=1 لأن الاتصال واحد لا غيره.
 */
async function detectSessionState(originalTimeout: string | null) {
  return withGuard("session-state", async () => {
    // set_config(name, value, is_local=false) هي SET نفسها لكن كدالة —
    // فتمرّ القيمة كمعامل مُرتبط، ولا يُركَّب أي نصّ SQL في هذا الملف
    // إطلاقاً. ولا تُقبَل أي قيمة من الطلب: الوسيط ثابت في الكود.
    await sql`select set_config('statement_timeout', ${PROBE_TIMEOUT_MARKER}, false)`;
    const [row] = await sql<{ observed: string }[]>`
      select current_setting('statement_timeout') as observed
    `;
    const observed = row?.observed ?? null;
    if (originalTimeout) {
      await sql`select set_config('statement_timeout', ${originalTimeout}, false)`;
    }
    return {
      marker: PROBE_TIMEOUT_MARKER,
      observed,
      persisted: observed === PROBE_TIMEOUT_MARKER,
      restoredTo: originalTimeout,
    };
  });
}

/** استعلام يتجاوز المهلة: هل يوقفه الخادم، ومتى، وهل يبقى الاتصال سليماً؟ */
async function probeLongQuery() {
  const attempt = await withGuard("long-query", async () => {
    await sql`select pg_sleep(${LONG_SLEEP_SECONDS})`;
    return "completed" as const;
  });

  // السؤال الثاني في طلبك: «وما كيخليش الاتصال معلقاً». نثبته باستعلام
  // تافه بعده مباشرة — نجاحه يعني أن الاتصال عاد للمجمّع سليماً.
  const after = await withGuard("after-long-query", async () => {
    const [row] = await sql<{ ok: number }[]>`select 1 as ok`;
    return row?.ok === 1;
  });

  return {
    requestedSleepSeconds: LONG_SLEEP_SECONDS,
    elapsedMs: attempt.elapsedMs,
    stoppedByServer: attempt.error?.fromServer === true,
    error: attempt.error,
    guardFired: attempt.guardFired,
    connectionUsableAfter: after.value === true,
    connectionCheckMs: after.elapsedMs,
  };
}

/**
 * سلوك معاملة sql.begin() عند تجاوز المهلة — وهو السؤال الذي يمسّ الطلبيات
 * والمخزون مباشرة. نكتب صفّاً أولاً ثم نُعلِّق المعاملة: المطلوب إثباته أن
 * المهلة تُرجِع المعاملة **كاملة** فلا يبقى نصف طلب مكتوباً.
 *
 * ملاحظة مقصودة: استعلامات داخل sql.begin لا تمرّ من Proxy الخاص بـdb.ts،
 * فلا مؤقّت إلغاء من جهة العميل هنا إطلاقاً — ما يوقف هذه المعاملة هو
 * الخادم وحده، وهذا بالضبط ما نريد قياسه بلا تشويش.
 */
async function probeTransaction() {
  const tableReady = await withGuard("probe-table", async () => {
    const [row] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = ${PROBE_TABLE}
      ) as exists
    `;
    return row?.exists === true;
  });

  if (tableReady.value !== true) {
    return {
      skipped: true,
      reason: `جدول public.${PROBE_TABLE} غير موجود على هذه القاعدة`,
      elapsedMs: 0,
      error: null as StepError | null,
      rolledBack: null as boolean | null,
      rowsAfter: null as number | null,
      guardFired: false,
    };
  }

  await withGuard("probe-clear", async () => {
    await sql`delete from public.diag_probe`;
    return true;
  });

  const attempt = await withGuard("transaction", async () => {
    await sql.begin(async (trx) => {
      await trx`insert into public.diag_probe (note) values ('before-sleep')`;
      await trx`select pg_sleep(${LONG_SLEEP_SECONDS})`;
      await trx`insert into public.diag_probe (note) values ('after-sleep')`;
    });
    return "committed" as const;
  });

  const rowsAfter = await withGuard("probe-rows", async () => {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from public.diag_probe
    `;
    return row?.count ?? null;
  });

  return {
    skipped: false,
    reason: null,
    elapsedMs: attempt.elapsedMs,
    error: attempt.error,
    guardFired: attempt.guardFired,
    rowsAfter: rowsAfter.value,
    // صفر صفوف بعد فشل المعاملة = إرجاع كامل، لا نصف كتابة.
    rolledBack: attempt.value === null && rowsAfter.value === 0,
  };
}

type PoolRow = {
  total: number;
  active: number;
  idle: number;
  idle_in_transaction: number;
  waiting_on_client: number;
  waiting_on_lock: number;
};

/**
 * الاتصالات المحجوزة والانتظار. من جهتين لأن أياً منهما لا تكفي وحدها:
 * `pg_stat_activity` يرى اتصالات Supavisor على الخادم ولا يرى طابور عميلنا
 * داخل النسخة؛ وعدّادات db.ts ترى الطابور ولا ترى الخوادم.
 */
async function readPoolState() {
  const server = await withGuard("pool", async () => {
    const [row] = await sql<PoolRow[]>`
      select
        count(*)::int                                                              as total,
        count(*) filter (where state = 'active')::int                              as active,
        count(*) filter (where state = 'idle')::int                                as idle,
        count(*) filter (where state = 'idle in transaction')::int                  as idle_in_transaction,
        count(*) filter (where wait_event_type = 'Client')::int                    as waiting_on_client,
        count(*) filter (where wait_event_type = 'Lock')::int                      as waiting_on_lock
      from pg_stat_activity
      where backend_type = 'client backend'
        and application_name like 'Supavisor%'
    `;
    return row ?? null;
  });

  const limits = await withGuard("limits", async () => {
    const [row] = await sql<{ max_connections: string; reserved: string }[]>`
      select
        current_setting('max_connections')                  as max_connections,
        current_setting('superuser_reserved_connections')   as reserved
    `;
    return row ?? null;
  });

  return {
    supavisorBackends: server.value,
    serverLimits: limits.value,
    clientQueueCounters: dbQueryCounters(),
  };
}

export type SessionModeReport = Awaited<ReturnType<typeof runSessionModeProbe>>;

export async function runSessionModeProbe() {
  const startedAt = new Date().toISOString();
  const settingsBefore = await readServerSettings();
  const sessionState = await detectSessionState(
    settingsBefore.value?.statement_timeout ?? null
  );
  const longQuery = await probeLongQuery();
  const transaction = await probeTransaction();
  const pool = await readPoolState();
  const settingsAfter = await readServerSettings();

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    runtimeConfig: dbRuntimeConfig(),
    serverSettings: settingsBefore.value,
    serverSettingsError: settingsBefore.error,
    sessionState: sessionState.value,
    sessionStateError: sessionState.error,
    longQuery,
    transaction,
    pool,
    /**
     * استقرار الاتصال بعد الخمول وإعادة الاستعمال: نفس معرّف عملية الخادم
     * في بداية الطلب ونهايته يعني أن الاتصال نفسه خدم الطلب كله؛ ومقارنة
     * هذا المعرّف بين طلبين متباعدين زمنياً هي اختبار إعادة الاستعمال بعد
     * خمول حقيقي (لا يمكن اختصاره داخل طلب واحد).
     */
    connectionReuse: {
      backendPidAtStart: settingsBefore.value?.backend_pid ?? null,
      backendPidAtEnd: settingsAfter.value?.backend_pid ?? null,
      sameBackendThroughout:
        settingsBefore.value != null &&
        settingsAfter.value != null &&
        settingsBefore.value.backend_pid === settingsAfter.value.backend_pid,
      backendStartedAt: settingsAfter.value?.backend_started_at ?? null,
      secondsSinceBackendStart: settingsAfter.value?.seconds_since_backend_start ?? null,
    },
  };
}
