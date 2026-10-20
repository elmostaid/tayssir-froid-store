/**
 * مقياس صلابة الاتصال — قبل الإصلاح وبعده، بنفس السيناريوهات بالحرف.
 *
 * لا يلمس هذا النص أي شيء حقيقي: قاعدة محلية معزولة (tayssir_resilience)
 * على 127.0.0.1، وبينها وبين التطبيق **وكيل TCP** يُحقن فيه العطل. فالعطل
 * الذي نقيسه ليس محاكاة في الكود بل انقطاع حقيقي على مستوى المقبس، وهو
 * بالضبط ما يصفه توثيق Supabase: مقبس يبقى مفتوحاً ظاهرياً ولا يحمل شيئاً.
 *
 * التشغيل:
 *   scripts/setup-resilience-db.sh   (مرّة واحدة)
 *   npx tsx scripts/db-resilience-scenarios.mts
 *
 * الملف الناتج: تقرير JSON على stdout، صفّان لكل سيناريو — baseline (الكود
 * الحالي حرفياً: الفحص والإتلاف مُطفأان بمتغيّري بيئة) وfixed (الافتراضي).
 */
import net from "node:net";
import postgres from "postgres";

const UPSTREAM_HOST = "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.RESILIENCE_PG_PORT ?? 5433);
const PROXY_PORT = Number(process.env.RESILIENCE_PROXY_PORT ?? 5499);
const DB_NAME = "tayssir_resilience";

/**
 * سقف القياس. سقف Vercel الحقيقي 300 ثانية، ولا معنى لانتظاره اثنتي عشرة
 * مرة: ما يهمّ هو التمييز بين «محدود عند ثوانٍ معدودة» و«غير محدود». فأي
 * عملية تتجاوز هذا السقف تُسجَّل `unbounded` — أي أنها كانت ستصل إلى 300
 * ثانية، وهو ما شوهد فعلاً في سجلات الإنتاج.
 */
const CEILING_MS = 30000;

type Mode = "pass" | "blackhole" | "mute-server" | "stall" | "drop";

type Pair = { client: net.Socket; upstream: net.Socket | null; muted: boolean };

class FaultProxy {
  mode: Mode = "pass";
  private server: net.Server | null = null;
  private pairs = new Set<Pair>();

  private forwardsClientToServer(): boolean {
    return this.mode === "pass" || this.mode === "mute-server";
  }
  private forwardsServerToClient(): boolean {
    return this.mode === "pass";
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((client) => {
        if (this.mode === "drop") {
          client.destroy();
          return;
        }

        const pair: Pair = { client, upstream: null, muted: false };
        this.pairs.add(pair);
        client.on("error", () => {});
        client.on("close", () => {
          this.pairs.delete(pair);
          pair.upstream?.destroy();
        });

        // "stall": نقبل اتصال TCP ولا نفتح شيئاً نحو الخادم ولا نردّ —
        // فالمصافحة (SSLRequest/StartupMessage) تبقى بلا جواب إلى الأبد.
        // هذا هو «المصافحة المتوقّفة».
        if (this.mode === "stall") {
          client.on("data", () => {});
          return;
        }

        const upstream = net.createConnection(
          { host: UPSTREAM_HOST, port: UPSTREAM_PORT },
          () => {}
        );
        pair.upstream = upstream;
        // لا نُغلق مقبس العميل عندما يموت الطرف الآخر إن كان الزوج
        // «مكتوماً»: الفرق بين إغلاق معلوم ومقبس ميت صامت هو جوهر العلّة.
        upstream.on("error", () => {
          if (!pair.muted) client.destroy();
        });
        upstream.on("close", () => {
          if (!pair.muted) client.destroy();
        });

        client.on("data", (chunk) => {
          if (pair.muted) return;
          if (this.forwardsClientToServer() && !upstream.destroyed) upstream.write(chunk);
        });
        upstream.on("data", (chunk) => {
          if (pair.muted) return;
          if (this.forwardsServerToClient() && !client.destroyed) client.write(chunk);
        });
      });

      server.on("error", reject);
      server.listen(PROXY_PORT, "127.0.0.1", () => {
        this.server = server;
        resolve();
      });
    });
  }

  /**
   * يُميت المقابس **القائمة** فقط ويُبقي الشبكة سليمة لما يأتي بعدها:
   * يُقطع الاتصال الحقيقي نحو الخادم، ويبقى مقبس العميل مفتوحاً وصامتاً
   * إلى الأبد. هذه هي الحالة التي يصفها توثيق Supabase حرفياً — المجمّع
   * أو NAT أسقط الاتصال الخامل أثناء تجميد الدالة — وهي الأهم، لأن كل
   * شيء آخر في الشبكة يعمل، فالاستعادة ممكنة فوراً إن عرف العميل أن
   * مقبسه مات.
   */
  muteExisting(): void {
    for (const pair of this.pairs) {
      pair.muted = true;
      pair.upstream?.destroy();
    }
  }

  /** يقطع كل المقابس القائمة — تنظيف بين السيناريوهات فقط. */
  cutAll(): void {
    for (const pair of [...this.pairs]) {
      pair.upstream?.destroy();
      pair.client.destroy();
    }
    this.pairs.clear();
  }

  async close(): Promise<void> {
    this.cutAll();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }
}

// ── قناة جانبية: اتصال مباشر بالخادم، خارج الوكيل، لرؤية ما يراه الخادم
// فعلاً (عدد الاتصالات، الصفوف المكتوبة) بلا أن يتأثر بالعطل المحقون.
const side = postgres(`postgres://postgres@${UPSTREAM_HOST}:${UPSTREAM_PORT}/postgres`, {
  max: 1,
  idle_timeout: 60,
  prepare: false,
});

async function backendsOnTestDb(): Promise<number> {
  const rows = await side<{ n: string }[]>`
    select count(*)::text as n from pg_stat_activity where datname = ${DB_NAME}
  `;
  return Number(rows[0].n);
}

async function terminateTestDbBackends(): Promise<void> {
  await side`
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = ${DB_NAME} and pid <> pg_backend_pid()
  `;
}

// قناة ثانية موجَّهة إلى قاعدة الاختبار نفسها، للقراءة والتنظيف.
const sideTest = postgres(`postgres://postgres@${UPSTREAM_HOST}:${UPSTREAM_PORT}/${DB_NAME}`, {
  max: 1,
  idle_timeout: 60,
  prepare: false,
});

async function rowsWithTag(tag: string): Promise<number> {
  const rows = await sideTest<{ n: string }[]>`
    select count(*)::text as n from public.probe_writes where tag = ${tag}
  `;
  return Number(rows[0].n);
}

// ── أدوات قياس
type Settlement = { kind: "resolved" | "rejected"; atMs: number; code?: string };

function track(promise: Promise<unknown>, startedAt: number): () => Settlement | null {
  let settlement: Settlement | null = null;
  void promise.then(
    () => {
      settlement = { kind: "resolved", atMs: Math.round(performance.now() - startedAt) };
    },
    (error: unknown) => {
      settlement = {
        kind: "rejected",
        atMs: Math.round(performance.now() - startedAt),
        code: codeOf(error),
      };
    }
  );
  return () => settlement;
}

function codeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (error instanceof Error) return error.message.slice(0, 60);
  return String(error).slice(0, 60);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** ينتظر وعداً بسقف صارم، ويُبلِّغ بدقة هل حُسم أم بقي معلَّقاً. */
async function withCeiling<T>(
  promise: Promise<T>,
  startedAt: number,
  ceilingMs = CEILING_MS
): Promise<{ elapsedMs: number; outcome: string; code?: string; value?: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<"unbounded">((r) => {
    timer = setTimeout(() => r("unbounded"), ceilingMs);
  });
  try {
    const result = await Promise.race([
      promise.then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e })
      ),
      ceiling,
    ]);
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (result === "unbounded") {
      void promise.then(
        () => {},
        () => {}
      );
      return { elapsedMs, outcome: `unbounded (>${ceilingMs}ms)` };
    }
    return result.ok
      ? { elapsedMs, outcome: "resolved", value: result.v }
      : { elapsedMs, outcome: "rejected", code: codeOf(result.e) };
  } finally {
    clearTimeout(timer);
  }
}

// ── تحميل التطبيق نفسه (لا نسخة منه): نُوجِّه DATABASE_URL إلى الوكيل قبل
// أول استيراد، ثم نستعمل sql وsafeQuery وdbGuard الحقيقيين كما في الموقع.
process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${PROXY_PORT}/${DB_NAME}`;
const { sql, dbGuard } = await import("../src/lib/db");
const { safeQuery } = await import("../src/lib/safeQuery");

type Profile = "baseline" | "fixed";

/**
 * baseline يُطفئ الإصلاح بمتغيّري بيئة فقط — نفس الكود المنشور بالحرف.
 * وهذا مقصود مرتين: يجعل المقارنة على بناء واحد بلا فرق آخر، وهو نفسه
 * **خطة الرجوع**: ضبط هذين المتغيّرين على `off` في Vercel يُعيد السلوك
 * السابق بلا نشر جديد.
 */
function applyProfile(profile: Profile): void {
  if (profile === "baseline") {
    process.env.DB_LIVENESS_PREFLIGHT = "off";
    process.env.DB_HANG_ESCALATION = "off";
  } else {
    delete process.env.DB_LIVENESS_PREFLIGHT;
    delete process.env.DB_HANG_ESCALATION;
  }
}

const proxy = new FaultProxy();

type Result = Record<string, unknown>;

async function freshStart(): Promise<void> {
  proxy.mode = "pass";
  await dbGuard.reset();
  proxy.cutAll();
  await terminateTestDbBackends();
  await sleep(150);
}

/** استعلام قراءة حقيقي من نوع ما تنفّذه صفحات المتجر. */
function readQuery() {
  return sql<{ n: number }[]>`select count(*)::int as n from public.probe_writes`;
}

async function warmUp(): Promise<void> {
  await readQuery();
}

/** يقيس استعادة الخدمة بعد رجوع الشبكة: أول قراءة تنجح، وبعد كم. */
async function measureRecovery(): Promise<Result> {
  proxy.mode = "pass";
  const startedAt = performance.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const outcome = await withCeiling(
      safeQuery(() => readQuery(), null as { n: number }[] | null, "recovery"),
      startedAt,
      15000
    );
    if (outcome.outcome === "resolved") {
      // safeQuery تُرجع القيمة الاحتياطية عند الفشل، فالنجاح الحقيقي هو
      // أن تعود بيانات لا بـnull.
      const value = await safeQuery(() => readQuery(), null, "recovery-value");
      if (value !== null) {
        return {
          recoveredAfterMs: Math.round(performance.now() - startedAt),
          attempts: attempt,
        };
      }
    }
    await sleep(500);
  }
  return { recoveredAfterMs: null, attempts: 3, note: "لم تستعد الخدمة داخل 3 محاولات" };
}

// ─────────────────────────────────────────────────────────────────────────
// السيناريوهات
// ─────────────────────────────────────────────────────────────────────────

/** 0 — ثمن الفحص المسبق تحت حمل متواصل، وبعد فجوة خمول. */
async function scenarioOverhead(): Promise<Result> {
  await freshStart();
  await warmUp();

  const steady: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await safeQuery(() => readQuery(), null, "overhead-steady");
    steady.push(performance.now() - t);
  }
  steady.sort((a, b) => a - b);

  // فجوة خمول أطول من staleAfterMs: هنا وحده يُفترض أن يعمل الفحص.
  await sleep(5600);
  const t = performance.now();
  await safeQuery(() => readQuery(), null, "overhead-after-idle");
  const afterIdleMs = Math.round(performance.now() - t);

  return {
    steadyP50Ms: Math.round(steady[Math.floor(steady.length / 2)]),
    steadyMaxMs: Math.round(steady[steady.length - 1]),
    afterIdleGapMs: afterIdleMs,
    guard: dbGuard.stats(),
  };
}

/**
 * كيف نكسر الوصلة:
 *  - `stale-socket`: المقابس القائمة تموت صامتةً والشبكة سليمة لما بعدها.
 *    هذه حالة «تجميد الدالة» الموصوفة في توثيق Supabase.
 *  - `outage`: كل شيء مقطوع، القديم والجديد. هذه حالة «المجمّع نفسه
 *    لا يستجيب» كما في عناقيد CONNECT_TIMEOUT يوم 20 أكتوبر.
 */
type BreakKind = "stale-socket" | "outage";

function breakLink(kind: BreakKind): void {
  if (kind === "outage") {
    proxy.mode = "blackhole";
    return;
  }
  proxy.muteExisting();
  proxy.mode = "pass";
}

/** 1 — مقبس ميت ثم قراءة عبر مسار الموقع (safeQuery) — شكل الزائر. */
function scenarioRead(kind: BreakKind) {
  return async function run(): Promise<Result> {
    await freshStart();
    await warmUp();

    breakLink(kind);
    // فجوة أطول من staleAfterMs، كما بين طلب وطلب على نسخة مجمَّدة.
    await sleep(5600);

    const startedAt = performance.now();
    let inner: () => Settlement | null = () => null;
    const visible = await withCeiling(
      safeQuery(
        () => {
          // الاستعلام يُبنى **داخل** run كما في التطبيق بالحرف — أي بعد
          // الفحص المسبق، فيرث العميل الذي اختاره الفحص.
          const query = readQuery();
          inner = track(query as unknown as Promise<unknown>, startedAt);
          return query as unknown as Promise<{ n: number }[]>;
        },
        null as { n: number }[] | null,
        `read-${kind}`
      ),
      startedAt
    );

    const backendsDuring = await backendsOnTestDb();
    // ⚠️ safeQuery تُحسَم دائماً تقريباً — بالقيمة الاحتياطية عند الفشل.
    // فـ«resolved» وحدها لا تعني أن الزائر رأى بياناته. الدليل الوحيد هو
    // أن تعود قيمة غير null.
    const servedRealData = visible.outcome === "resolved" && visible.value != null;
    // نترك فرصة للإتلاف أن يرفض الوعد الداخلي بعد أن استلم الزائر صفحته.
    await sleep(1500);

    return {
      visitorWaitedMs: visible.elapsedMs,
      visitorOutcome: visible.outcome,
      servedRealData,
      innerQuerySettlement:
        inner() ?? "ما زال معلَّقاً — وهذا هو ما يُمسك النسخة إلى سقف المنصّة",
      backendsDuring,
      guard: dbGuard.stats(),
      ...(await measureRecovery()),
      backendsAfterRecovery: await backendsOnTestDb(),
    };
  };
}

/** 2 — نفس العطل بلا safeQuery: شكل تجديد الكاش في الخلفية (waitUntil). */
function scenarioBackground(kind: BreakKind) {
  return async function run(): Promise<Result> {
    await freshStart();
    await warmUp();
    breakLink(kind);
    await sleep(5600);

    const startedAt = performance.now();
    // لا أحد ينتظر هذه القراءة؛ الزائر استلم صفحته من الكاش. ما يُقاس هنا
    // هو كم تبقى نسخة الدالة محتجزة بسببها.
    const outcome = await withCeiling(
      readQuery() as unknown as Promise<unknown>,
      startedAt
    );
    const backendsDuring = await backendsOnTestDb();

    return {
      backgroundWorkHeldMs: outcome.elapsedMs,
      outcome: outcome.outcome,
      code: outcome.code,
      backendsDuring,
      guard: dbGuard.stats(),
      ...(await measureRecovery()),
    };
  };
}

/** 3 — مصافحة متوقّفة على عميل بارد (لا مقبس قديم يمكن فحصه). */
async function scenarioStalledHandshake(): Promise<Result> {
  await freshStart();
  proxy.mode = "stall";

  const startedAt = performance.now();
  const outcome = await withCeiling(
    readQuery() as unknown as Promise<unknown>,
    startedAt
  );

  return {
    elapsedMs: outcome.elapsedMs,
    outcome: outcome.outcome,
    code: outcome.code,
    guard: dbGuard.stats(),
    ...(await measureRecovery()),
  };
}

/** 4 — المقبس يموت **أثناء** استعلام جارٍ: إعادة إنتاج 20 أكتوبر. */
async function scenarioSocketDiesMidQuery(): Promise<Result> {
  await freshStart();
  await warmUp();

  const startedAt = performance.now();
  // استعلام أطول من statement_timeout (8s) عمداً: لو كان المقبس حيّاً
  // لأوقفه الخادم بـ57014 عند 8 ثوان. القطع يمنع وصول ذلك الإيقاف —
  // وهذا بالضبط ما رأيناه: صمت تام في سجلات Postgres، وتعليق عند العميل.
  const query = sql`select pg_sleep(30)`;
  const inner = track(query as unknown as Promise<unknown>, startedAt);
  await sleep(600);
  breakLink("stale-socket");

  const outcome = await withCeiling(query as unknown as Promise<unknown>, startedAt);
  const backendsDuring = await backendsOnTestDb();

  return {
    elapsedMs: outcome.elapsedMs,
    outcome: outcome.outcome,
    code: outcome.code,
    innerSettlement: inner(),
    backendsDuring,
    guard: dbGuard.stats(),
    ...(await measureRecovery()),
  };
}

/**
 * 7 — تسميم المجمّع: هذا هو العطل كما عاشه الزبناء يوم 20 أكتوبر.
 *
 * نفتح `max` اتصالاً (5) ثم نُميتها كلها صامتةً، ثم نُطلق 5 استعلامات
 * تنزل على تلك المقابس الميتة. كل واحد منها يحجز اتصالاً من أصل 5 ولا
 * يُحسم أبداً — فالنسخة ساخنة، تستقبل الزبناء، ومجمّعها مفقود بالكامل.
 * ثم نقيس ما يراه الزائر السادس.
 */
async function scenarioPoolExhaustion(): Promise<Result> {
  await freshStart();
  // 5 استعلامات متزامنة تفتح 5 اتصالات فعلية (max = 5).
  await Promise.all([1, 2, 3, 4, 5].map(() => readQuery()));
  const backendsWarm = await backendsOnTestDb();

  breakLink("stale-socket");

  const hung = [1, 2, 3, 4, 5].map(() => {
    const started = performance.now();
    const query = readQuery();
    return track(query as unknown as Promise<unknown>, started);
  });
  await sleep(800);

  const startedAt = performance.now();
  const visitor = await withCeiling(
    safeQuery(() => readQuery(), null as { n: number }[] | null, "poisoned-pool"),
    startedAt,
    25000
  );

  await sleep(1500);
  const stillPending = hung.filter((h) => h() === null).length;

  return {
    backendsWarm,
    visitorWaitedMs: visitor.elapsedMs,
    visitorOutcome: visitor.outcome,
    servedRealData: visitor.outcome === "resolved" && visitor.value != null,
    // الرقم الحاسم: كم اتصالاً من أصل 5 ما زال محجوزاً إلى الأبد.
    connectionsStillHeld: stillPending,
    hungSettlements: hung.map((h) => h() ?? "معلَّق"),
    guard: dbGuard.stats(),
    ...(await measureRecovery()),
  };
}

/**
 * 8 — السؤال بعينه: هل يمكن لإتلافٍ سببه تعليق **قراءة** أن يقطع كتابةً
 * متزامنة؟
 *
 * `mute-server` يجعل ما نكتبه يصل إلى الخادم وما يردّ به يُفقَد. فالقراءة
 * تتعلّق، والكتابة **تُنفَّذ على الخادم فعلاً** ويُفقَد جوابها — أي أسوأ
 * لحظة ممكنة للإتلاف. ثم نقيس عند 15 ثانية (بعد نقطة تصعيد القراءة 13،
 * وقبل نهاية عقد الكتابة 20) وعند 23 ثانية.
 */
async function scenarioReadHangVsWrite(): Promise<Result> {
  await freshStart();
  // ⚠️ اتصالان مفتوحان قبل العطل، لا واحد. وهذا ليس تفصيلاً: مع
  // `mute-server` لا تكتمل مصافحة أي اتصال **جديد** (جوابها مفقود) فيفشل
  // عند connect_timeout بعد 5 ثوان — فلو اقتسم الاستعلامان اتصالاً واحداً
  // لما وصلت الكتابة إلى الخادم إطلاقاً، ولقِسنا شيئاً آخر تماماً.
  await Promise.all([readQuery(), readQuery()]);
  const tag = `read-vs-write-${Date.now()}`;

  proxy.mode = "mute-server";
  const startedAt = performance.now();

  const read = sql`select count(*)::int as n from public.probe_writes`;
  const readSettled = track(read as unknown as Promise<unknown>, startedAt);
  const write = sql`insert into public.probe_writes (tag) values (${tag})`;
  const writeSettled = track(write as unknown as Promise<unknown>, startedAt);

  await sleep(15000);
  const at15s = {
    generation: dbGuard.stats().generation,
    destroyedClients: dbGuard.stats().destroyedClients,
    recyclesDeferred: dbGuard.stats().recyclesDeferred,
    writesBlockingRecycle: dbGuard.stats().writesBlockingRecycle,
    readSettlement: readSettled() ?? "معلَّقة",
    writeSettlement: writeSettled() ?? "معلَّقة",
  };

  await sleep(8000);
  const at23s = {
    generation: dbGuard.stats().generation,
    writesBlockingRecycle: dbGuard.stats().writesBlockingRecycle,
    writeSettlement: writeSettled() ?? "معلَّقة",
  };

  proxy.mode = "pass";
  await sleep(300);
  await terminateTestDbBackends();
  await sleep(400);
  const rows = await rowsWithTag(tag);

  return {
    at15s,
    at23s,
    // الشرط الحاسم: صفّ واحد. الكتابة نُفِّذت مرّة، ولا شيء كرّرها.
    rowsWithTag: rows,
    noDuplicate: rows <= 1,
    ...(await measureRecovery()),
  };
}

/** 5 — انقطاع **قبل** COMMIT: المعاملة يجب أن تُرجَع بلا أي صفّ. */
async function scenarioWriteBeforeCommit(): Promise<Result> {
  await freshStart();
  await warmUp();
  const tag = `before-commit-${Date.now()}`;

  const startedAt = performance.now();
  const transaction = sql.begin(async (trx) => {
    await trx`insert into public.probe_writes (tag) values (${tag})`;
    // الآن، وقبل أن يُرسل postgres.js COMMIT، يموت المقبس صامتاً.
    breakLink("stale-socket");
  });

  const outcome = await withCeiling(transaction as unknown as Promise<unknown>, startedAt);
  const guardDuring = dbGuard.stats();
  const backendsDuring = await backendsOnTestDb();

  proxy.mode = "pass";
  await sleep(300);
  await terminateTestDbBackends();
  await sleep(300);

  return {
    elapsedMs: outcome.elapsedMs,
    outcome: outcome.outcome,
    code: outcome.code,
    // الشرط الحاسم: صفر. المعاملة لم تُؤكَّد، فلا يجوز أن يبقى صفّ.
    rowsWithTag: await rowsWithTag(tag),
    recycleDeferredWhileWriting: guardDuring.recyclesDeferred,
    writesInFlightSeen: guardDuring.writesInFlight,
    backendsDuring,
    guardAfter: dbGuard.stats(),
    ...(await measureRecovery()),
  };
}

/** 6 — COMMIT وصل والجواب فُقد: نتيجة مجهولة، ولا تكرار بأي حال. */
async function scenarioWriteAfterCommit(): Promise<Result> {
  await freshStart();
  await warmUp();
  const tag = `after-commit-${Date.now()}`;

  const startedAt = performance.now();
  const transaction = sql.begin(async (trx) => {
    await trx`insert into public.probe_writes (tag) values (${tag})`;
    // mute-server: ما يُكتَب يصل إلى الخادم، وما يردّ به الخادم يُفقَد.
    // فـCOMMIT يصل ويُنفَّذ، ولا يصل جوابه أبداً — وهذه أسوأ حالة ممكنة.
    proxy.mode = "mute-server";
  });

  const outcome = await withCeiling(transaction as unknown as Promise<unknown>, startedAt);
  const guardDuring = dbGuard.stats();

  proxy.mode = "pass";
  await sleep(300);
  await terminateTestDbBackends();
  await sleep(400);

  const rows = await rowsWithTag(tag);
  return {
    elapsedMs: outcome.elapsedMs,
    outcome: outcome.outcome,
    code: outcome.code,
    // 1 متوقَّع: COMMIT نُفِّذ فعلاً. والشرط الحاسم أنه ليس 2 أبداً —
    // أي أن لا شيء في النظام أعاد المحاولة من تلقاء نفسه.
    rowsWithTag: rows,
    noDuplicate: rows <= 1,
    recycleDeferredWhileWriting: guardDuring.recyclesDeferred,
    guardAfter: dbGuard.stats(),
    ...(await measureRecovery()),
  };
}

const SCENARIOS: Array<[string, () => Promise<Result>]> = [
  ["0-overhead", scenarioOverhead],
  ["1a-read-stale-socket", scenarioRead("stale-socket")],
  ["1b-read-outage", scenarioRead("outage")],
  ["2a-background-stale-socket", scenarioBackground("stale-socket")],
  ["2b-background-outage", scenarioBackground("outage")],
  ["3-stalled-handshake", scenarioStalledHandshake],
  ["4-socket-dies-mid-query", scenarioSocketDiesMidQuery],
  ["7-pool-exhaustion", scenarioPoolExhaustion],
  ["8-read-hang-vs-write", scenarioReadHangVsWrite],
  ["5-write-before-commit", scenarioWriteBeforeCommit],
  ["6-write-after-commit", scenarioWriteAfterCommit],
];

async function main(): Promise<void> {
  await proxy.listen();
  await sideTest`truncate public.probe_writes`;

  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const report: Record<string, Record<string, Result>> = {};

  for (const profile of ["baseline", "fixed"] as Profile[]) {
    applyProfile(profile);
    report[profile] = {};
    for (const [name, run] of SCENARIOS) {
      if (only && !name.includes(only)) continue;
      process.stderr.write(`\n▶ ${profile} / ${name}\n`);
      try {
        report[profile][name] = await run();
      } catch (error) {
        report[profile][name] = { crashed: codeOf(error) };
      }
      process.stderr.write(`  ${JSON.stringify(report[profile][name])}\n`);
    }
  }

  await freshStart();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  await proxy.close();
  await Promise.all([side.end({ timeout: 2 }), sideTest.end({ timeout: 2 })]);
  await dbGuard.reset();
}

await main();
process.exit(0);
