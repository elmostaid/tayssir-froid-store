import type postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

/**
 * ## المشكلة التي يحلّها هذا الملف
 *
 * Vercel **تُجمِّد** الدالة بعد الجواب. ما كان جارياً على قاعدة البيانات
 * لحظة التجميد يبقى نصفياً. ومع `prepare: false` يُرسَل كل استعلام بقيم على
 * مرحلتين (Parse+Describe+Flush، ثم Bind+Execute+Sync)، وبينهما معاملة ضمنية
 * مفتوحة على الخادم. فإن جُمِّدت الدالة بين المرحلتين، يقتل Postgres الاتصال
 * بعد `transaction_timeout = 45s` (FATAL 25P04، آخر أمر PARSE) — مُثبَت في
 * سجلات الإنتاج (19 حالة في 24 ساعة، كلها عند PARSE) ومُعاد إنتاجه على
 * PostgreSQL 17.6 محلياً. وعند استئناف الدالة يجد الاستعلام التالي مقبساً
 * ميتاً أو خطأً قديماً ينتظره.
 *
 * ## لماذا لم يعد الحلّ «فحص ثم إتلاف فوري»
 *
 * الإصدار السابق كان يفحص اتصالاً واحداً (`select 1`) بعد الخمول، وعند أي
 * فشل — أو عند تعليق قراءة 13 ثانية — يُتلف العميل **كله** فوراً
 * (`end({ timeout: 0 })`). وهذا كان يرفض كل استعلام سليم جارٍ على الاتصالات
 * الأربعة الأخرى في نفس اللحظة: كل أخطاء CONNECTION_DESTROYED في الإنتاج
 * منذ 20 أكتوبر مصدرها هذا الإتلاف نفسه، لا Supabase. والفحص نفسه لا يرى
 * إلا اتصالاً واحداً من خمسة، فنجاحه لم يكن يضمن الباقي.
 *
 * ## الآلية الآن: تدوير هادئ
 *
 * - **بعد فجوة خمول** (لا استعلام بدأ ولا انتهى منذ `rotateAfterIdleMs`)
 *   تبدأ الطلبات الجديدة على عميل جديد بمقابس جديدة — بلا فحص. أي تجميد
 *   حقيقي أطول من ذلك، فلا يُعاد استعمال مقبس من قبل التجميد أبداً.
 * - **العميل القديم يُقاعَد لا يُتلَف**: `end({ timeout })` يترك كل استعلام
 *   جارٍ يكتمل، ولا يرفض إلا ما بقي بعد مهلة التصريف. والمهلة محسوبة من
 *   أحدث استعلام جارٍ عليه: لا تنتهي قبل أن يبلغ ذلك الاستعلام سقفه الطبيعي
 *   (إلغاء عند 10 ثوان + 3 ثوان سماح). فلا يُقطَع استعلام سليم مهما طال
 *   ضمن حدوده، ولا يعيش استعلام معلَّق أكثر من سقفه.
 * - **تعليق قراءة بعد الإلغاء** يُقاعِد العميل بنفس الطريقة، فلا يُستعمل
 *   للطلبات الجديدة، ولا يُرفَض ما يجري عليه إلا عند انتهاء التصريف.
 * - العميل المُقاعَد لا يستقبل استعلاماً جديداً: الوكيل `sql` يسأل دائماً
 *   عن العميل الحالي.
 *
 * ## حدود متعمَّدة — سلامة الطلبيات أولاً (بلا تغيير)
 *
 * - عقد كتابة نشط على العميل الحالي يمنع تقاعده إلى أن تُحسَم الكتابة،
 *   ثم يُقاعَد. فلا تصير نتيجة COMMIT مجهولة بسببنا.
 * - لا إعادة محاولة تلقائية لأي استعلام، لا قراءة ولا كتابة.
 */

/** الإلغاء عند العميل (db.ts) — التصريف يُحسب منه، فلا ينحرف الرقمان. */
export const QUERY_HARD_TIMEOUT_MS = 10000;

export type DbResilienceConfig = {
  /** التدوير بعد الخمول. `off` يُبقي العميل نفسه مهما طال الخمول. */
  rotation: boolean;
  /** هل يُقاعَد العميل عندما يتعلّق استعلام قراءة بعد فشل cancel()؟ */
  escalation: boolean;
  /** فجوة خمول تكفي لافتراض أن المقابس قد تكون ماتت (تجميد). */
  rotateAfterIdleMs: number;
  /** مهلة إضافية بعد cancel() قبل الحكم بأن الاستعلام لن يُرفَض أبداً. */
  escalateGraceMs: number;
  /** حد أدنى بين تقاعدَين بسبب تعليق — يمنع حلقة تحت عطل مستمر. */
  recycleCooldownMs: number;
  /** أقلّ مهلة تصريف للعميل المُقاعَد، ولو لم يكن عليه استعلام مُتتبَّع. */
  retireMinDrainMs: number;
};

export const DB_RESILIENCE_DEFAULTS: DbResilienceConfig = {
  rotation: true,
  escalation: true,
  // أقصر من idle_timeout (20s) في db.ts: الاتصالات كانت ستُغلَق عند 20s على
  // أي حال لولا التجميد، فالتدوير بعد 15s لا يكاد يضيف اتصالاً جديداً،
  // ويضمن ألا يُستعمل مقبس من قبل تجميد. وأقصر بكثير من 45s التي يقتل
  // الخادم بعدها معاملةً نصفية.
  rotateAfterIdleMs: 15000,
  escalateGraceMs: 3000,
  recycleCooldownMs: 10000,
  retireMinDrainMs: 2000,
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
    // `DB_LIVENESS_PREFLIGHT` هو اسم المفتاح القديم — يبقى مقروءاً حتى لا
    // يتغيّر معنى إعداد موجود عند الرجوع أو التقدّم.
    rotation: readFlag(env.DB_IDLE_ROTATION ?? env.DB_LIVENESS_PREFLIGHT, d.rotation),
    escalation: readFlag(env.DB_HANG_ESCALATION, d.escalation),
    rotateAfterIdleMs: readMs(env.DB_STALE_AFTER_MS, d.rotateAfterIdleMs, 1000, 600000),
    escalateGraceMs: readMs(env.DB_ESCALATE_GRACE_MS, d.escalateGraceMs, 250, 60000),
    recycleCooldownMs: readMs(env.DB_RECYCLE_COOLDOWN_MS, d.recycleCooldownMs, 0, 600000),
    retireMinDrainMs: readMs(env.DB_RETIRE_MIN_DRAIN_MS, d.retireMinDrainMs, 0, 60000),
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
  | "rotated"
  | "rotation-deferred"
  | "failed";

export type RecycleOutcome =
  | { recycled: true; generation: number; drainMs: number }
  | {
      recycled: false;
      reason: "no-client" | "deferred-write-in-flight" | "cooldown" | "disabled" | "not-current";
      writesInFlight?: number;
    };

export type PreflightResult = {
  action: PreflightAction;
  /** عمر آخر نشاط لحظة القرار — هو ما يُفسِّر قرار التدوير. */
  idleMs: number | null;
  errorCode?: string;
  recycle?: RecycleOutcome;
};

export type GuardStats = {
  generation: number;
  hasClient: boolean;
  idleMs: number | null;
  /** استعلامات جارية على العميل الحالي (مُتتبَّعة عبر db.ts). */
  inflight: number;
  writesInFlight: number;
  /** منها ما يمنع التقاعد فعلاً الآن — الباقي تجاوز موعده. */
  writesBlockingRecycle: number;
  condemned: boolean;
  preflights: Record<PreflightAction, number>;
  recycles: number;
  recyclesDeferred: number;
  recyclesOnCooldown: number;
  escalations: number;
  /** عملاء ما زالوا في التصريف الآن — يجب أن يبقى صغيراً ويعود إلى صفر. */
  retiring: number;
  retiredClients: number;
  /** عملاء أُغلقوا بالقوة (reset فقط). */
  destroyedClients: number;
};

type WriteLease = { deadlineAt: number };

type Slot = {
  client: SqlClient;
  generation: number;
  /** آخر بدء أو انتهاء استعلام — لا «آخر نجاح»: الخمول هو غياب النشاط. */
  lastActivityAt: number | null;
  /** الاستعلامات الجارية الآن وبداية كلٍّ منها — منها تُحسب مهلة التصريف. */
  inflight: Map<symbol, number>;
  /**
   * عقود الكتابة الجارية على هذه الشريحة. عقدٌ لم يتجاوز موعده يمنع
   * التقاعد منعاً مطلقاً. وعقدٌ تجاوز موعده يتوقّف عن المنع فقط — ولا
   * يُسبِّب تقاعداً بنفسه أبداً.
   */
  writeLeases: Set<WriteLease>;
  condemned: boolean;
};

type Retiring = { generation: number; startedAt: number; drainMs: number };

const noop = () => {};

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "UNKNOWN";
}

function emptyPreflightCounts(): Record<PreflightAction, number> {
  return {
    disabled: 0,
    "skipped-cold": 0,
    "skipped-fresh": 0,
    rotated: 0,
    "rotation-deferred": 0,
    failed: 0,
  };
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
  private readonly slots = new WeakMap<SqlClient, Slot>();
  private readonly retiring = new Set<Retiring>();

  private counters = {
    preflights: emptyPreflightCounts(),
    recycles: 0,
    recyclesDeferred: 0,
    recyclesOnCooldown: 0,
    escalations: 0,
    retiredClients: 0,
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
    if (this.deps.onEvent) {
      this.deps.onEvent({ kind, detail });
      return;
    }
    // كل مسار في Next على Vercel دالةٌ منفصلة لها حارسها: السجلّ الموحَّد
    // هو الطريق الوحيد لرؤية ما يحدث عبرها. ولا يُسجَّل إلا الحدث الحقيقي.
    console.log(`[db-resilience] ${kind} ${JSON.stringify(detail)}`);
  }

  private newSlot(): Slot {
    const slot: Slot = {
      client: this.deps.create(),
      generation: ++this.generation,
      lastActivityAt: null,
      inflight: new Map(),
      writeLeases: new Set(),
      condemned: false,
    };
    this.slots.set(slot.client, slot);
    return slot;
  }

  /** العميل الحالي، يُنشأ عند أول طلب. */
  current(): SqlClient {
    if (!this.slot) this.slot = this.newSlot();
    return this.slot.client;
  }

  /**
   * يُستدعى من db.ts عند أول `then` لكل استعلام على `client` بعينه، ويُرجع
   * دالة تُستدعى عند انتهائه نجاحاً أو فشلاً. منه يُعرف الخمول الحقيقي،
   * ومنه تُحسب مهلة تصريف العميل إن قوعِد والاستعلام جارٍ.
   */
  trackQuery(client: SqlClient): () => void {
    const slot = this.slots.get(client);
    if (!slot) return noop;
    const id = Symbol("query");
    const startedAt = this.now();
    slot.inflight.set(id, startedAt);
    slot.lastActivityAt = startedAt;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      slot.inflight.delete(id);
      slot.lastActivityAt = this.now();
    };
  }

  /** للتوافق: نجاحٌ نشاطٌ كذلك. */
  noteHealthy(): void {
    if (this.slot) this.slot.lastActivityAt = this.now();
  }

  /**
   * عقد الكتابة: يُرجع العميل **وقفله معاً، في عملية واحدة** — فلا لحظة
   * بينهما يمكن أن يُقاعَد فيها العميل الذي ستجري عليه المعاملة.
   */
  leaseForWrite(ttlMs: number): { client: SqlClient; release: () => void } {
    const client = this.current();
    return { client, release: this.leaseForClient(client, ttlMs).release };
  }

  /**
   * عقد كتابة على **عميل بعينه**. إن لم يكن هو الحالي فقد قوعِد أصلاً،
   * والعميل المُقاعَد لا يُرفَض فيه شيء قبل انتهاء تصريفه — فيُرجَع عقد فارغ.
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
      // حُكم على الشريحة أثناء الكتابة ⇒ تُقاعَد الآن، بعد أن حُسمت.
      if (slot.writeLeases.size === 0 && slot.condemned && this.slot === slot) {
        this.requestRecycle("deferred-after-write");
      }
    };
    return { leased: true, release };
  }

  private blockingWrites(slot: Slot): number {
    const now = this.now();
    let blocking = 0;
    for (const lease of slot.writeLeases) if (lease.deadlineAt > now) blocking += 1;
    return blocking;
  }

  /** الخمول = منذ آخر بدء أو انتهاء استعلام، بما فيه استعلام عالق من قبل تجميد. */
  private idleMs(slot: Slot | null = this.slot): number | null {
    if (!slot || slot.lastActivityAt === null) return null;
    return this.now() - slot.lastActivityAt;
  }

  /**
   * يُستدعى **قبل** بناء استعلام القراءة. لا يرسل أي شيء إلى القاعدة:
   * إن مرّت فجوة خمول، يبدأ هذا الطلب وما بعده على عميل جديد، ويُقاعَد
   * القديم بهدوء. اسمه باقٍ كما كان لأن المستدعين لم يتغيّروا.
   *
   * ⚠️ عقد صريح: لا ترمي أبداً.
   */
  async ensureLive(): Promise<PreflightResult> {
    const config = this.config();
    if (!config.rotation) return this.record({ action: "disabled", idleMs: this.idleMs() });

    try {
      this.current();
    } catch (error) {
      // الخطأ الصحيح (مثلاً DATABASE_URL غائب) يجب أن يأتي من الاستعلام
      // الحقيقي كما كان دائماً، لا من هنا.
      return this.record({ action: "failed", idleMs: null, errorCode: errorCodeOf(error) });
    }

    const idleMs = this.idleMs();
    if (idleMs === null) return this.record({ action: "skipped-cold", idleMs });
    if (idleMs < config.rotateAfterIdleMs) return this.record({ action: "skipped-fresh", idleMs });

    const recycle = this.requestRecycle("idle-gap", { ignoreCooldown: true });
    return this.record({
      action: recycle.recycled ? "rotated" : "rotation-deferred",
      idleMs,
      recycle,
    });
  }

  private record(result: PreflightResult): PreflightResult {
    this.counters.preflights[result.action] += 1;
    // الحالات الغالبة (عميل حيّ بالنشاط، أو جديد، أو مُطفأ) ضجيجٌ بحجم
    // الحركة. التدوير وتأجيله والفشل قليلة بطبعها وتستحقّ سطراً.
    if (result.action === "rotation-deferred" || result.action === "failed") {
      this.emit("preflight", {
        action: result.action,
        idleMs: result.idleMs,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.recycle ? { recycle: result.recycle } : {}),
      });
    }
    return result;
  }

  /**
   * تبديل العميل الحالي بآخر جديد، وتقاعد القديم بهدوء. الترتيب مقصود:
   * الطلب التالي يجد عميلاً جاهزاً فوراً ولا ينتظر شيئاً.
   */
  requestRecycle(reason: string, options: { ignoreCooldown?: boolean } = {}): RecycleOutcome {
    const slot = this.slot;
    if (!slot) return { recycled: false, reason: "no-client" };

    const blocking = this.blockingWrites(slot);
    if (blocking > 0) {
      slot.condemned = true;
      this.counters.recyclesDeferred += 1;
      this.emit("recycle-deferred", { reason, writesInFlight: blocking });
      return { recycled: false, reason: "deferred-write-in-flight", writesInFlight: blocking };
    }

    const config = this.config();
    if (
      !options.ignoreCooldown &&
      this.lastRecycleAt !== null &&
      this.now() - this.lastRecycleAt < config.recycleCooldownMs
    ) {
      this.counters.recyclesOnCooldown += 1;
      this.emit("recycle-cooldown", { reason });
      return { recycled: false, reason: "cooldown" };
    }

    const idleMs = this.idleMs(slot);
    this.slot = this.newSlot();
    this.lastRecycleAt = this.now();
    this.counters.recycles += 1;
    const drainMs = this.retire(slot);
    this.emit("recycle", {
      reason,
      generation: this.slot.generation,
      idleMs,
      inflightOnOld: slot.inflight.size,
      drainMs,
      retiring: this.retiring.size,
    });
    return { recycled: true, generation: this.slot.generation, drainMs };
  }

  /**
   * مهلة التصريف: لا تنتهي قبل أن يبلغ **أحدث** استعلام جارٍ على هذا العميل
   * سقفه الطبيعي (إلغاء + سماح). استعلامٌ سليم ينتهي قبلها حتماً (أو يُلغى
   * عند 10 ثوان فيردّ الخادم الحيّ فوراً). وما بقي بعدها معلَّقٌ على مقبس
   * ميت، فرفضه هو الصواب.
   */
  private drainMsFor(slot: Slot): number {
    const config = this.config();
    const ceiling = QUERY_HARD_TIMEOUT_MS + config.escalateGraceMs + 500;
    let newest: number | null = null;
    for (const startedAt of slot.inflight.values()) {
      if (newest === null || startedAt > newest) newest = startedAt;
    }
    const needed = newest === null ? 0 : newest + ceiling - this.now();
    return Math.min(ceiling, Math.max(config.retireMinDrainMs, needed));
  }

  private retire(slot: Slot): number {
    const drainMs = this.drainMsFor(slot);
    const entry: Retiring = { generation: slot.generation, startedAt: this.now(), drainMs };
    this.retiring.add(entry);
    this.counters.retiredClients += 1;
    // end({timeout}) لا يقبل استعلاماً جديداً، ويترك الجاري يكتمل، ثم
    // يُغلق المقابس. وإن بقي شيء عند انتهاء المهلة يُرفَض محلياً
    // (CONNECTION_DESTROYED) — وهو ما يُنهي التعليق على مقبس ميت.
    void Promise.resolve(slot.client.end({ timeout: drainMs / 1000 }))
      .catch(noop)
      .finally(() => {
        this.retiring.delete(entry);
        this.emit("retired", {
          generation: entry.generation,
          elapsedMs: this.now() - entry.startedAt,
          drainMs,
          leftInflight: slot.inflight.size,
        });
      });
    return drainMs;
  }

  /**
   * تُستدعى عند تعليق استعلام قراءة رغم cancel() — راجع db.ts. لا تمسّ إلا
   * العميل الذي علق عليه الاستعلام إن كان هو الحالي: عميلٌ مُقاعَد أصلاً
   * سيُنهيه تصريفه، ولا يجوز أن يُقاعَد بسببه عميلٌ جديد سليم.
   */
  noteHangEscalation(reason: string, client?: SqlClient): RecycleOutcome {
    if (!this.config().escalation) return { recycled: false, reason: "disabled" };
    if (client && (!this.slot || this.slot.client !== client)) {
      return { recycled: false, reason: "not-current" };
    }
    this.counters.escalations += 1;
    return this.requestRecycle(reason);
  }

  stats(): GuardStats {
    return {
      generation: this.generation,
      hasClient: this.slot !== null,
      idleMs: this.idleMs(),
      inflight: this.slot?.inflight.size ?? 0,
      writesInFlight: this.slot?.writeLeases.size ?? 0,
      writesBlockingRecycle: this.slot ? this.blockingWrites(this.slot) : 0,
      condemned: this.slot?.condemned ?? false,
      preflights: { ...this.counters.preflights },
      recycles: this.counters.recycles,
      recyclesDeferred: this.counters.recyclesDeferred,
      recyclesOnCooldown: this.counters.recyclesOnCooldown,
      escalations: this.counters.escalations,
      retiring: this.retiring.size,
      retiredClients: this.counters.retiredClients,
      destroyedClients: this.counters.destroyedClients,
    };
  }

  /** للاختبارات ونصوص القياس فقط: يُنهي العميل الحالي ويُصفِّر كل شيء. */
  async reset(): Promise<void> {
    const slot = this.slot;
    this.slot = null;
    this.lastRecycleAt = null;
    this.retiring.clear();
    this.counters = {
      preflights: emptyPreflightCounts(),
      recycles: 0,
      recyclesDeferred: 0,
      recyclesOnCooldown: 0,
      escalations: 0,
      retiredClients: 0,
      destroyedClients: 0,
    };
    if (slot) {
      this.counters.destroyedClients += 1;
      await Promise.resolve(slot.client.end({ timeout: 0 })).catch(noop);
    }
  }
}
