import type postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

/**
 * ## المشكلة التي يحلّها هذا الملف
 *
 * توثيق Supabase الرسمي يصف الحالة بالحرف (troubleshooting-connect_timeout-
 * or-hanging-queries-in-vercel-serverless-functions): البيئة الخادومية
 * **تُجمِّد** الدالة بين طلب وطلب. أثناء التجميد تتوقّف مؤقّتات keep_alive
 * عند العميل، فيُسقط المجمّع أو NAT اتصال TCP الخامل بلا إشعار. وعند
 * استئناف الدالة يحاول العميل إعادة استعمال **مقبس ميت**: الكتابة تنجح
 * ظاهرياً (البايتات تذهب إلى العدم)، ولا يأتي أي رد، ولا يُغلق المقبس —
 * فيتعلَّق الاستعلام إلى سقف التنفيذ.
 *
 * وهذا يطابق ما قِسناه فعلاً في سجلات Vercel يوم 20 أكتوبر: عناقيد
 * CONNECT_TIMEOUT وETIMEDOUT(-110) وCONNECTION_CLOSED على منفذ المجمّع،
 * مع **صمت كامل في سجلات Postgres** في نفس اللحظة — أي أن الطلب لم يصل
 * إلى القاعدة أصلاً.
 *
 * ## لماذا لا يكفي ما عندنا اليوم
 *
 * db.ts يربط كل استعلام بمؤقّت يستدعي `query.cancel()` الحقيقي. وهذا
 * يُنهي الحالة الأولى فقط. راجع `cancel()` في
 * node_modules/postgres/src/index.js:350 — له ثلاثة فروع:
 *   1. الاستعلام ما زال في طابور العميل (`!query.state`): يُحذف من
 *      الطابور ويُرفَض فوراً بـ57014. ✅ هذه حالتنا عند إشباع المجمّع.
 *   2. الاستعلام أُرسل وهو نشط (`query.state && query.active`): يُفتح
 *      **اتصال جديد** لإرسال CancelRequest. الوعد الأصلي **لا يُرفَض
 *      محلياً**؛ يبقى معلَّقاً في انتظار أن يردّ الخادم بخطأ على المقبس
 *      الأصلي. ❌ وإذا كان ذلك المقبس ميتاً فلا يأتي رد أبداً، والاتصال
 *      الجديد نفسه يتعلّق لأن المشكلة في الشبكة لا في الاستعلام.
 *   3. الاستعلام أُرسل خلف استعلام آخر (pipelined): يُعلَّم `cancelled`
 *      فقط، بلا رفض محلي. ❌ نفس النتيجة.
 *
 * ففروع 2 و3 هي بالضبط سقف 300 ثانية. و`Promise.race` وحدها لا تُصلحها:
 * الخاسر يُتخلّى عنه ولا يُلغى، فيبقى الاتصال محجوزاً من أصل `max` إلى
 * الأبد — وهو ما سمّم المجمّع قبلاً (راجع safeQuery.ts).
 *
 * ## الآلية الوحيدة التي تُرفَض بها هذه الوعود فعلياً
 *
 * `sql.end({ timeout: 0 })` ← `destroy()` ← `c.terminate()`، و`terminate()`
 * في connection.js:422 يفعل حرفياً:
 *     if (stream || query || initial || sent.length)
 *       error(Errors.connection('CONNECTION_DESTROYED', options))
 * أي يرفض الاستعلام الجاري **وكل** ما في `sent[]` رفضاً محلياً فورياً، بلا
 * انتظار أي بايت من الخادم. هذه هي النقطة الوحيدة في postgres.js التي
 * تحوّل تعليقاً غير محدود إلى فشل محدود. فكل ما يفعله هذا الملف مبني
 * عليها: نُشخِّص المقبس الميت، ثم **نُعيد إنشاء العميل** ونُتلف القديم —
 * فيتحرّر كل وعد معلَّق عليه، ويبدأ الطلب التالي على مقابس جديدة.
 *
 * ## حدود متعمَّدة — سلامة الطلبيات أولاً
 *
 * إتلاف العميل أثناء معاملة كتابة جارية يجعل نتيجة COMMIT **مجهولة**: لا
 * نعرف هل وصل COMMIT إلى الخادم قبل انقطاع المقبس أم لا. لذلك:
 *   - `writesInFlight > 0` يمنع الإتلاف منعاً مطلقاً. يُؤجَّل ويُنفَّذ عند
 *     انتهاء آخر معاملة كتابة (condemned).
 *   - لا إعادة محاولة تلقائية لأي شيء، لا قراءة ولا كتابة. الفحص المسبق
 *     يسبق إنشاء استعلام القراءة، فتُنفَّذ القراءة **مرّة واحدة** على
 *     العميل الجديد — وهذا ليس إعادة محاولة بل اختيار اتصال سليم قبل
 *     البدء.
 */

export type DbResilienceConfig = {
  /** هل يُشغَّل الفحص المسبق أصلاً؟ `off` يُعيد سلوك الإنتاج الحالي بالحرف. */
  preflight: boolean;
  /** هل يُتلَف العميل عندما يتعلّق استعلام بعد فشل cancel()؟ */
  escalation: boolean;
  /** لا فحص مسبق إذا كان آخر نجاح أحدث من هذا — فلا ثمن تحت حمل متواصل. */
  staleAfterMs: number;
  /** سقف الفحص المسبق نفسه. قصير بالضرورة: هو في مسار كل قراءة باردة. */
  preflightTimeoutMs: number;
  /** مهلة إضافية بعد cancel() قبل الحكم بأن الاستعلام لن يُرفَض أبداً. */
  escalateGraceMs: number;
  /** حد أدنى بين إتلافَين — يمنع حلقة إتلاف/إنشاء تحت عطل مستمر. */
  recycleCooldownMs: number;
};

export const DB_RESILIENCE_DEFAULTS: DbResilienceConfig = {
  preflight: true,
  escalation: true,
  // أي تجميد حقيقي بين طلبين يتجاوز هذا بكثير، وأي حمل حقيقي يبقى تحته —
  // فالفحص يعمل بعد الفجوات فقط، لا على كل طلب.
  staleAfterMs: 5000,
  // أطول من زمن ذهاب وإياب حقيقي إلى eu-north-1 بعشرات الأضعاف، وأقصر
  // بكثير من connect_timeout (5s) حتى لا نخلط «مقبس ميت» بـ«اتصال جديد
  // يُفتح الآن».
  preflightTimeoutMs: 2500,
  escalateGraceMs: 3000,
  recycleCooldownMs: 10000,
};

function readFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "off" || v === "false" || v === "0") return false;
  if (v === "on" || v === "true" || v === "1") return true;
  return fallback;
}

function readMs(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function readDbResilienceConfig(
  env: Record<string, string | undefined> = process.env
): DbResilienceConfig {
  const d = DB_RESILIENCE_DEFAULTS;
  return {
    preflight: readFlag(env.DB_LIVENESS_PREFLIGHT, d.preflight),
    escalation: readFlag(env.DB_HANG_ESCALATION, d.escalation),
    staleAfterMs: readMs(env.DB_STALE_AFTER_MS, d.staleAfterMs, 500, 600000),
    preflightTimeoutMs: readMs(env.DB_PREFLIGHT_TIMEOUT_MS, d.preflightTimeoutMs, 250, 10000),
    escalateGraceMs: readMs(env.DB_ESCALATE_GRACE_MS, d.escalateGraceMs, 250, 60000),
    recycleCooldownMs: readMs(env.DB_RECYCLE_COOLDOWN_MS, d.recycleCooldownMs, 0, 600000),
  };
}

/**
 * تصنيف العبارة من **الأجزاء الثابتة** لقالَب الوسم فقط — أي من النص الذي
 * كتبه مطوِّر في الملف، لا من أي قيمة يُرسلها مستخدم (قيم المستخدم تمرّ
 * كمعاملات مربوطة `${...}` ولا تدخل هنا إطلاقاً). فلا مجال لأن تُحوِّل
 * قيمةُ زبون قراءةً إلى كتابة أو العكس.
 *
 * والقاعدة متحفِّظة في اتجاه واحد: لا تُصنَّف عبارة قراءةً إلا إذا بدأت
 * بـ`select` **ولم** يظهر فيها أي فعل كتابة إطلاقاً. فـ
 * `with x as (insert ...) select ...` كتابةٌ، وكل ما لم نفهمه كتابةٌ. ثمن
 * الخطأ في جانب «كتابة» حمايةٌ زائدة لبضع ثوانٍ؛ وفي الجانب الآخر طلبية.
 */
export type StatementKind = "read" | "write";

const WRITE_VERBS =
  /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|comment|refresh|call|do|copy|lock|reindex|vacuum|analyze|set|reset|begin|commit|rollback|savepoint|prepare|listen|notify|select\s+(?:set_config|pg_terminate_backend|pg_cancel_backend|nextval|setval))\b/i;

export function classifyStatement(strings: readonly string[] | null): StatementKind {
  if (!strings || strings.length === 0) return "write";
  const text = strings.join(" ");
  const trimmed = text.replace(/(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/g, " ").trimStart();
  if (!/^select\b/i.test(trimmed)) return "write";
  return WRITE_VERBS.test(trimmed) ? "write" : "read";
}

export type PreflightAction =
  | "disabled"
  | "skipped-cold"
  | "skipped-fresh"
  | "passed"
  | "timed-out"
  | "failed";

export type RecycleOutcome =
  | { recycled: true; generation: number }
  | {
      recycled: false;
      reason: "no-client" | "deferred-write-in-flight" | "cooldown";
      writesInFlight?: number;
    };

export type PreflightResult = {
  action: PreflightAction;
  elapsedMs: number;
  /** عمر آخر نجاح معروف لحظة القرار — هو ما يُفسِّر `skipped-fresh`. */
  idleMs: number | null;
  errorCode?: string;
  recycle?: RecycleOutcome;
};

export type GuardStats = {
  generation: number;
  hasClient: boolean;
  idleMs: number | null;
  writesInFlight: number;
  /** منها ما يمنع الإتلاف فعلاً الآن — الباقي تجاوز موعده. */
  writesBlockingRecycle: number;
  condemned: boolean;
  preflights: Record<PreflightAction, number>;
  recycles: number;
  recyclesDeferred: number;
  recyclesOnCooldown: number;
  escalations: number;
  destroyedClients: number;
};

type WriteLease = { deadlineAt: number };

type Slot = {
  client: SqlClient;
  generation: number;
  lastHealthyAt: number | null;
  /**
   * عقود الكتابة الجارية على هذه الشريحة. عقدٌ لم يتجاوز موعده يمنع
   * الإتلاف منعاً مطلقاً. وعقدٌ تجاوز موعده يتوقّف عن المنع فقط — ولا
   * يُسبِّب إتلافاً بنفسه أبداً. أي أن الكتابة تحصل على **حماية** لا على
   * عدوانية: كتابة معلَّقة وحدها على نسخة خاملة لا تُتلف شيئاً، لكنها لا
   * تُقفل استعادة القراءات إلى الأبد.
   */
  writeLeases: Set<WriteLease>;
  condemned: boolean;
};

const noop = () => {};

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "UNKNOWN";
}

/**
 * الحارس لا يعرف كيف يُبنى العميل ولا كيف يُقرأ الوقت — يتلقّاهما. فيصير
 * قابلاً للاختبار بعميل مُلفَّق وبساعة مُسيَّرة، بلا قاعدة بيانات ولا
 * انتظار حقيقي، ويبقى في الإنتاج هو نفسه الكود بالحرف.
 */
export class ConnectionGuard {
  private slot: Slot | null = null;
  private generation = 0;
  private lastRecycleAt: number | null = null;
  private inFlight: Promise<PreflightResult> | null = null;

  private counters = {
    preflights: {
      disabled: 0,
      "skipped-cold": 0,
      "skipped-fresh": 0,
      passed: 0,
      "timed-out": 0,
      failed: 0,
    } as Record<PreflightAction, number>,
    recycles: 0,
    recyclesDeferred: 0,
    recyclesOnCooldown: 0,
    escalations: 0,
    destroyedClients: 0,
  };

  constructor(
    private readonly deps: {
      create: () => SqlClient;
      now?: () => number;
      config?: () => DbResilienceConfig;
      onEvent?: (event: { kind: string; detail: Record<string, unknown> }) => void;
    }
  ) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private config(): DbResilienceConfig {
    return (this.deps.config ?? readDbResilienceConfig)();
  }

  private emit(kind: string, detail: Record<string, unknown>): void {
    this.deps.onEvent?.({ kind, detail });
  }

  /** العميل الحالي، يُنشأ عند أول طلب. */
  current(): SqlClient {
    if (this.slot) return this.slot.client;
    this.slot = {
      client: this.deps.create(),
      generation: ++this.generation,
      lastHealthyAt: null,
      writeLeases: new Set(),
      condemned: false,
    };
    return this.slot.client;
  }

  /** يُعلَن عند كل استعلام نجح فعلاً — وهو ما يُعرِّف «العميل حيّ». */
  noteHealthy(): void {
    if (this.slot) this.slot.lastHealthyAt = this.now();
  }

  /**
   * عقد الكتابة: يُرجع العميل **وقفله معاً، في عملية واحدة**.
   *
   * ولماذا ليس «زِد العدّاد» ثم «خُذ العميل» في خطوتين: لأن بينهما ثغرة
   * حقيقية ولو ضيّقة — لو وقع إتلاف في تلك اللحظة، لارتفع العدّاد على
   * الشريحة الجديدة بينما تجري المعاملة على العميل القديم، فيصير العميل
   * القديم قابلاً للإتلاف وفيه COMMIT جارٍ. العقد يربط القفل بالشريحة
   * التي سلّمها بعينها، فلا توجد لحظة بينهما أصلاً.
   */
  leaseForWrite(ttlMs: number): { client: SqlClient; release: () => void } {
    const client = this.current();
    return { client, release: this.leaseForClient(client, ttlMs).release };
  }

  /**
   * عقد كتابة على **عميل بعينه**.
   *
   * ولماذا بعينه: العقد قد يُطلَب بعد لحظة من إنشاء الاستعلام (التسليح
   * يقع عند أول `then`)، وقد يكون إتلافٌ وقع بينهما. فلو رُفع العقد على
   * «العميل الحالي» أيّاً كان، لحمينا شريحةً لا تجري عليها كتابة وتركنا
   * الكتابة الحقيقية بلا حماية. وإن لم يكن هذا العميل هو الحالي، فشريحته
   * أُتلفت أصلاً واستعلاماتها مرفوضة — فالحماية بلا معنى، ويُرجَع عقد
   * فارغ.
   */
  leaseForClient(
    client: SqlClient,
    ttlMs: number
  ): { leased: boolean; release: () => void } {
    const slot = this.slot;
    if (!slot || slot.client !== client) return { leased: false, release: () => {} };

    const lease: WriteLease = {
      deadlineAt: Number.isFinite(ttlMs) ? this.now() + ttlMs : Number.POSITIVE_INFINITY,
    };
    slot.writeLeases.add(lease);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      slot.writeLeases.delete(lease);
      // إن حُكم على هذه الشريحة أثناء الكتابة، يُنفَّذ الإتلاف الآن —
      // بعد أن صارت نتيجة الكتابة معروفة ومسجَّلة. فلا يبقى عميل معروف
      // الموت في الخدمة، ولا يُتلَف وهناك COMMIT قد يصير مجهولاً.
      if (
        slot.writeLeases.size === 0 &&
        slot.condemned &&
        this.slot === slot
      ) {
        this.requestRecycle("deferred-after-write");
      }
    };
    return { leased: true, release };
  }

  /** عقود الكتابة التي ما زالت تمنع الإتلاف فعلاً (لم تتجاوز موعدها). */
  private blockingWrites(slot: Slot): number {
    const now = this.now();
    let blocking = 0;
    for (const lease of slot.writeLeases) if (lease.deadlineAt > now) blocking += 1;
    return blocking;
  }

  private idleMs(): number | null {
    if (!this.slot || this.slot.lastHealthyAt === null) return null;
    return this.now() - this.slot.lastHealthyAt;
  }

  /**
   * الفحص المسبق. يُستدعى **قبل** إنشاء استعلام القراءة، فإن اقتضى الأمر
   * إعادة إنشاء العميل، يُبنى الاستعلام على العميل الجديد من البداية — لا
   * إعادة إرسال لاستعلام سابق.
   */
  async ensureLive(): Promise<PreflightResult> {
    const config = this.config();
    const startedAt = this.now();

    if (!config.preflight) return this.record({ action: "disabled", elapsedMs: 0, idleMs: this.idleMs() });

    // ⚠️ عقد صريح: هذه الدالة **لا ترمي أبداً**. هي فحص صحّة لا مصدر
    // نتيجة، فلو رمت لصارت هي نفسها سبب فشل قراءة كانت ستنجح (مثلاً
    // DATABASE_URL غائب: الخطأ الصحيح يجب أن يأتي من الاستعلام الحقيقي
    // كما كان دائماً، لا من الفحص).
    try {
      this.current();
    } catch (error) {
      return this.record({
        action: "failed",
        elapsedMs: 0,
        idleMs: null,
        errorCode: errorCodeOf(error),
      });
    }
    const idleMs = this.idleMs();

    // عميل جديد لم ينجح له استعلام بعد: لا مقبس قديم يمكن أن يكون ميتاً،
    // فالفحص هنا مجرّد ثمن على البدء البارد — ومهلة الاتصال (5s) تكفيه.
    if (idleMs === null) return this.record({ action: "skipped-cold", elapsedMs: 0, idleMs });
    if (idleMs < config.staleAfterMs) return this.record({ action: "skipped-fresh", elapsedMs: 0, idleMs });

    // طلبات متزامنة في نفس النسخة تتشارك فحصاً واحداً، لا فحصاً لكل واحدة.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.runPreflight(startedAt, idleMs).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runPreflight(startedAt: number, idleMs: number): Promise<PreflightResult> {
    const config = this.config();
    const client = this.current();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = client`select 1 as ok`;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), config.preflightTimeoutMs);
    });

    try {
      const outcome = await Promise.race([
        (probe as unknown as Promise<unknown>).then(() => "ok" as const),
        timeout,
      ]);

      if (outcome === "ok") {
        this.noteHealthy();
        return this.record({ action: "passed", elapsedMs: this.now() - startedAt, idleMs });
      }

      // ⚠️ النقطة الحرجة: السباق انتهى، لكن `probe` **ما زال معلَّقاً** —
      // فلو توقّفنا هنا لكنّا فعلنا بالضبط ما نهى عنه الشرط: Promise.race
      // تتخلّى ولا تُلغي. الإتلاف أدناه هو ما يرفضه فعلياً عبر terminate().
      // ونُسكِت رفضه مسبقاً حتى لا يصير رفضاً غير مُلتقَط.
      (probe as unknown as Promise<unknown>).catch(noop);
      const recycle = this.requestRecycle("preflight-timeout");
      return this.record({
        action: "timed-out",
        elapsedMs: this.now() - startedAt,
        idleMs,
        recycle,
      });
    } catch (error) {
      // خطأ صريح من العميل (CONNECT_TIMEOUT، CONNECTION_CLOSED، ECONNRESET):
      // المقبس أعلن موته بنفسه. نُعيد الإنشاء كي لا يرث الطلب التالي نفس
      // الاتصال، ونُبلِّغ الرمز فقط — بلا رابط ولا كلمة سر.
      const recycle = this.requestRecycle("preflight-error");
      return this.record({
        action: "failed",
        elapsedMs: this.now() - startedAt,
        idleMs,
        errorCode: errorCodeOf(error),
        recycle,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private record(result: PreflightResult): PreflightResult {
    this.counters.preflights[result.action] += 1;
    if (result.action !== "skipped-fresh" && result.action !== "disabled") {
      this.emit("preflight", { ...result });
    }
    return result;
  }

  /**
   * إعادة إنشاء العميل: تبديل أولاً، ثم إتلاف القديم في الخلفية. الترتيب
   * مقصود — الطلب التالي يجد عميلاً جاهزاً فوراً ولا ينتظر إتلاف شيء.
   */
  requestRecycle(reason: string): RecycleOutcome {
    const slot = this.slot;
    if (!slot) return { recycled: false, reason: "no-client" };

    const blocking = this.blockingWrites(slot);
    if (blocking > 0) {
      slot.condemned = true;
      this.counters.recyclesDeferred += 1;
      this.emit("recycle-deferred", { reason, writesInFlight: blocking });
      return {
        recycled: false,
        reason: "deferred-write-in-flight",
        writesInFlight: blocking,
      };
    }

    const config = this.config();
    if (
      this.lastRecycleAt !== null &&
      this.now() - this.lastRecycleAt < config.recycleCooldownMs
    ) {
      this.counters.recyclesOnCooldown += 1;
      this.emit("recycle-cooldown", { reason });
      return { recycled: false, reason: "cooldown" };
    }

    const old = slot.client;
    this.slot = {
      client: this.deps.create(),
      generation: ++this.generation,
      lastHealthyAt: null,
      writeLeases: new Set(),
      condemned: false,
    };
    this.lastRecycleAt = this.now();
    this.counters.recycles += 1;
    this.emit("recycle", { reason, generation: this.slot.generation });

    this.destroy(old);
    return { recycled: true, generation: this.slot.generation };
  }

  private destroy(client: SqlClient): void {
    this.counters.destroyedClients += 1;
    // timeout: 0 ⇒ destroy() فوراً ⇒ terminate() لكل اتصال ⇒ رفض محلي
    // لكل استعلام جارٍ أو مُرسَل. هذا هو ما يُنهي التعليق، وهو السبب
    // الوحيد لوجود هذه الدالة.
    void Promise.resolve(client.end({ timeout: 0 })).catch(noop);
  }

  /** تُستدعى عند تعليق استعلام رغم cancel() — راجع db.ts. */
  noteHangEscalation(reason: string): RecycleOutcome {
    if (!this.config().escalation) {
      return { recycled: false, reason: "cooldown" };
    }
    this.counters.escalations += 1;
    return this.requestRecycle(reason);
  }

  stats(): GuardStats {
    return {
      generation: this.generation,
      hasClient: this.slot !== null,
      idleMs: this.idleMs(),
      writesInFlight: this.slot?.writeLeases.size ?? 0,
      writesBlockingRecycle: this.slot ? this.blockingWrites(this.slot) : 0,
      condemned: this.slot?.condemned ?? false,
      preflights: { ...this.counters.preflights },
      recycles: this.counters.recycles,
      recyclesDeferred: this.counters.recyclesDeferred,
      recyclesOnCooldown: this.counters.recyclesOnCooldown,
      escalations: this.counters.escalations,
      destroyedClients: this.counters.destroyedClients,
    };
  }

  /** للاختبارات ونصوص القياس فقط: يُنهي العميل الحالي ويُصفِّر كل شيء. */
  async reset(): Promise<void> {
    const slot = this.slot;
    this.slot = null;
    this.inFlight = null;
    this.lastRecycleAt = null;
    this.counters = {
      preflights: {
        disabled: 0,
        "skipped-cold": 0,
        "skipped-fresh": 0,
        passed: 0,
        "timed-out": 0,
        failed: 0,
      },
      recycles: 0,
      recyclesDeferred: 0,
      recyclesOnCooldown: 0,
      escalations: 0,
      destroyedClients: 0,
    };
    if (slot) await Promise.resolve(slot.client.end({ timeout: 0 })).catch(noop);
  }
}
