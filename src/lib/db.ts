import postgres from "postgres";
import { previewOnlyVerdict } from "@/lib/diagnostics/previewOnly";

type SqlClient = ReturnType<typeof postgres>;

// حد زمني حقيقي لكل استعلام على مستوى العميل — أقصر من مهلة safeQuery
// (15 ثانية) حتى يعمل هذا أولاً دائماً، وأطول قليلاً من statement_timeout
// (8 ثوان) حتى لا يسبق مهلة الخادم في الحالة التي يعمل فيها الخادم فعلاً.
const QUERY_HARD_TIMEOUT_MS = 10000;

/**
 * القيم التي كانت مكتوبة حرفياً داخل buildClient. تُستخرَج هنا لسببين: كي
 * يقرأها مسار التشخيص ويُبلِّغ عن الإعداد الفعلي بلا تكرار يدوي يتناقض مع
 * الواقع، وكي يبقى الافتراضي **نفسه بالحرف** عندما لا يُضبَط أي متغيّر
 * بيئة — فهذا الفرع فرع اختبار، ولا يجوز أن يغيّر سلوك الإنتاج بمجرّد دمجه.
 */
const DEFAULT_POOL_MAX = 5;
const DEFAULT_STATEMENT_TIMEOUT_MS = 8000;
const CONNECT_TIMEOUT_SECONDS = 5;
const IDLE_TIMEOUT_SECONDS = 20;
const MAX_LIFETIME_SECONDS = 60 * 30;

/**
 * حجم المجمّع من متغيّر بيئة — لمقارنة max=1 بـmax=2 على معاينة معزولة
 * خلف Supavisor في نمط الجلسة، حيث كل اتصال عميل يحجز خادماً كاملاً فيصير
 * العدد قراراً له ثمن مقيس، لا رقماً مكتوباً تخميناً.
 *
 * أي قيمة غائبة أو مشوَّهة أو خارج النطاق المعقول تُعيدنا إلى 5 بالضبط —
 * أي إلى سلوك الإنتاج الحالي حرفياً. فلا يمكن لمتغيّر بيئة خاطئ أن يُنتج
 * مجمّعاً بحجم صفر أو بحجم يُغرق قاعدة البيانات.
 */
function readPoolMax(raw: string | undefined = process.env.DB_POOL_MAX): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_POOL_MAX;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return DEFAULT_POOL_MAX;
  return parsed;
}

export type StatementTimeoutOption = { send: false } | { send: true; ms: number };

/**
 * هل نُرسل `statement_timeout` كمعامل بدء اتصال (startup parameter)؟
 *
 * هذا سؤال مقيس لا مفترض: مجمّع المعاملات **يرفض** هذا المعامل أصلاً
 * (`08P01 unsupported startup parameter`)، وتغيير المنفذ إلى 5432 وحده لا
 * يضمن قبوله — فتوثيق Supabase يقول إن المهلة على مستوى الجلسة «تعمل مع
 * نمط الجلسة أو الاتصال المباشر» دون أن يَعِد بقبول هذه الصيغة بالذات من
 * postgres.js. فنجعل الإرسال قابلاً للإطفاء (`off`) حتى نختبر الحالتين على
 * نفس النشر: مع المعامل وبدونه. الافتراضي بلا أي متغيّر = 8000 كما اليوم.
 */
function readStatementTimeoutOption(
  raw: string | undefined = process.env.DB_STATEMENT_TIMEOUT_MS
): StatementTimeoutOption {
  if (raw === undefined || raw.trim() === "")
    return { send: true, ms: DEFAULT_STATEMENT_TIMEOUT_MS };
  if (raw.trim().toLowerCase() === "off") return { send: false };
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 120000)
    return { send: true, ms: DEFAULT_STATEMENT_TIMEOUT_MS };
  return { send: true, ms: parsed };
}

export type ConnectionSource = "DATABASE_URL" | "DATABASE_URL_SESSION_TEST";

/**
 * رابط اتصال بديل **للاختبار فقط**، واسمه مختلف عن `DATABASE_URL` عمداً.
 *
 * سببه عملي: إضافة متغيّر ثانٍ بنفس المفتاح `DATABASE_URL` مقصوراً على فرع
 * واحد تصطدم في واجهة Vercel بتعارض «مفتاح مكرَّر لنفس البيئة» إن لم يُضبَط
 * حقل الفرع بدقّة، فيُحفَظ شيء غير المقصود أو لا يُحفَظ شيء أصلاً. ومفتاح
 * **جديد** لا يتعارض مع أي شيء ويُضاف في خطوة واحدة.
 *
 * وما يجعله آمناً ليس نطاق Vercel بل الكود نفسه: هذا السطر موجود في فرع
 * الاختبار وحده، فأي نشر آخر لا يقرأ هذا المتغيّر إطلاقاً ولو وُجد. ومع
 * ذلك نُضيف الحارس نفسه (previewOnlyVerdict): في أي نشر إنتاجي، أو في أي
 * معاينة غير متّصلة بمشروع Supabase المعزول، يُتجاهَل البديل كلياً ويُستعمل
 * `DATABASE_URL` كما هو — فلا يمكن لهذا المتغيّر أن يُحوِّل الإنتاج إلى
 * قاعدة أخرى بأي حال، لا بخطأ ولا بنيّة.
 */
function readConnectionSource(
  env: NodeJS.ProcessEnv = process.env
): { value: string | undefined; source: ConnectionSource } {
  const override = env.DATABASE_URL_SESSION_TEST?.trim();
  if (override && previewOnlyVerdict(env).allowed) {
    return { value: override, source: "DATABASE_URL_SESSION_TEST" };
  }
  return { value: env.DATABASE_URL, source: "DATABASE_URL" };
}

/**
 * الإعداد الفعلي الذي بُني به العميل — يقرأه مسار التشخيص ليقارن ما نظنّه
 * بما يقوله الخادم في `SHOW statement_timeout`. لا يحتوي ولا يستنتج أي سرّ:
 * لا رابط اتصال ولا كلمة سر ولا اسم مضيف، أرقاماً واسم المتغيّر المستعمل فقط.
 */
export function dbRuntimeConfig() {
  const statementTimeout = readStatementTimeoutOption();
  return {
    connectionSource: readConnectionSource().source,
    poolMax: readPoolMax(),
    statementTimeoutOptionMs: statementTimeout.send ? statementTimeout.ms : null,
    hardQueryTimeoutMs: QUERY_HARD_TIMEOUT_MS,
    connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
    idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
    maxLifetimeSeconds: MAX_LIFETIME_SECONDS,
    prepare: false as const,
  };
}

/**
 * عدّادات داخل النسخة — `postgres.js` لا يُصدِّر حالة مجمّعه (الطوابير
 * والاتصالات مُغلَقة داخل closure)، و`pg_stat_activity` يرى اتصالات
 * Supavisor لا طابور عميلنا. فهذه العدّادات هي الطريقة الوحيدة لمعرفة كم
 * استعلاماً كان **في الجوّ** فعلاً عند الذروة، وهو بالضبط ما يفرّق بين
 * max=1 وmax=2 تحت حمل.
 */
const queryCounters = { armed: 0, inFlight: 0, peakInFlight: 0, settled: 0 };

export function dbQueryCounters(): Readonly<typeof queryCounters> {
  return { ...queryCounters };
}

export function resetDbQueryCounters(): void {
  queryCounters.armed = 0;
  queryCounters.inFlight = 0;
  queryCounters.peakInFlight = 0;
  queryCounters.settled = 0;
}

type CancellableQuery = {
  then?: unknown;
  cancel?: () => void;
};

/**
 * السبب الجذري المُثبَت لانهيار الموقع تحت الضغط: safeQuery كان يستعمل
 * Promise.race، وهي صيغة **تتخلّى** عن الاستعلام عند انتهاء المهلة ولا
 * تُلغيه. postgres.js لا يعلم بذلك إطلاقاً — يبقى يعتبر الاتصال «مشغولاً
 * باستعلام جارٍ» ولا يُعيده إلى المجمّع أبداً. مع كل مهلة يُحجز اتصال من
 * أصل max حجزاً دائماً؛ وبعد max مهلات تكون نسخة الخادم قد فقدت مجمّعها
 * بالكامل وهي **لا تزال ساخنة وتستقبل الزبناء**، فتنتهي كل طلباتها اللاحقة
 * بالمهلة نفسها. هذا ما كان يجعل العطل «متقطّعاً»: نسخة مسمومة ترد بصفحة
 * عطل وأخرى سليمة ترد بالصفحة كاملة، في نفس اللحظة وعلى نفس الرابط.
 *
 * الإصلاح هنا يربط كل استعلام بحد زمني يستدعي query.cancel() الحقيقي من
 * postgres.js. هذه الدالة تُغطّي الحالتين معاً (راجع cancel() في
 * node_modules/postgres/src/index.js):
 *   - استعلام ما زال في طابور العميل ينتظر اتصالاً حراً (وهي حالتنا
 *     بالضبط عند إشباع المجمّع): يُحذَف من الطابور ويُرفَض فوراً بـ57014.
 *   - استعلام يُنفَّذ فعلاً على الخادم: يُفتح اتصال إلغاء حقيقي لإيقافه.
 * في الحالتين يُرفَض الوعد فعلياً، فيُحرِّر postgres.js الاتصال ويعيده
 * للمجمّع، ويلتقط catch الموجود أصلاً في safeQuery/catalog.ts الخطأ
 * فيُرجع البيانات الاحتياطية كما كان مصمَّماً — بدل تسميم المجمّع.
 *
 * لماذا نُرقِّع then() بدل استدعائه مباشرة: postgres.js يستعمل نفس نوع
 * Query لأجزاء الاستعلام (fragments) مثل sql`order by sale_price asc` في
 * catalog.ts. هذه الأجزاء تُدمَج داخل استعلام آخر عبر `instanceof Query`
 * وقراءة strings/args (types.js:110) ولا يُستدعى then() عليها أبداً.
 * التسليح عند أول then()/catch() فقط يضمن أن الأجزاء لا تُسلَّح ولا
 * تُنفَّذ كاستعلامات مستقلة — وهو ما كان سيحدث لو استدعينا then() مباشرة.
 */
function boundQueryLifetime<T>(query: T): T {
  const pending = query as CancellableQuery | null;
  if (
    !pending ||
    typeof pending.cancel !== "function" ||
    typeof pending.then !== "function"
  ) {
    return query;
  }

  const originalThen = pending.then as (...args: unknown[]) => unknown;
  const cancel = pending.cancel.bind(pending);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armed = false;

  const disarm = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const settle = () => {
    disarm();
    queryCounters.inFlight -= 1;
    queryCounters.settled += 1;
  };

  const arm = () => {
    if (armed) return;
    armed = true;
    queryCounters.armed += 1;
    queryCounters.inFlight += 1;
    if (queryCounters.inFlight > queryCounters.peakInFlight) {
      queryCounters.peakInFlight = queryCounters.inFlight;
    }
    timer = setTimeout(() => {
      timer = undefined;
      try {
        cancel();
      } catch {
        // cancel() نفسه قد يفشل لو كان الاتصال قد مات أصلاً — لا يهم،
        // المقصود ألا يبقى الاتصال محجوزاً، وهذا يتحقق في الحالتين.
      }
    }, QUERY_HARD_TIMEOUT_MS);

    // تنظيف المؤقّت عند انتهاء الاستعلام نجاحاً أو فشلاً. نستعمل then
    // الأصلي (قبل الترقيع) لتفادي أي تسلسل لا نهائي، وكلا المُعالِجَين
    // يُعيد undefined فلا ينشأ رفض غير مُلتقَط من هذا الفرع.
    Reflect.apply(originalThen, pending, [settle, settle]);
  };

  Object.defineProperty(pending, "then", {
    configurable: true,
    writable: true,
    value: function patchedThen(...args: unknown[]) {
      arm();
      return Reflect.apply(originalThen, pending, args);
    },
  });

  return query;
}

// نتفادى فتح اتصال جديد بقاعدة البيانات مع كل إعادة تحميل ساخنة (hot reload)
// أثناء التطوير عبر تخزين العميل في global.
declare global {
  var __tayssirSql: SqlClient | undefined;
}

let cachedClient: SqlClient | undefined;

// إنشاء العميل الحقيقي مؤجَّل حتى أول استعلام فعلي، بدل وقت استيراد هذا
// الملف. هذا يسمح بنجاح `next build` (الذي يُحمِّل كل الصفحات لجمع بياناتها
// حتى الصفحات التي لن تُستدعى فيها أي دالة sql فعلياً) حتى بدون DATABASE_URL،
// بينما تبقى أي محاولة استعلام حقيقي بدونه تفشل بنفس الرسالة كما كانت.
function getClient(): SqlClient {
  if (globalThis.__tayssirSql) return globalThis.__tayssirSql;
  if (cachedClient) return cachedClient;

  const { value: connectionString } = readConnectionSource();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL غير معرَّف. أضفه في ملف .env.local (انظر .env.example للتفاصيل)."
    );
  }

  let client: SqlClient;
  try {
    client = buildClient(connectionString);
  } catch (err) {
    // postgres() يتحقق من صيغة connectionString فوراً عند الإنشاء ويرمي
    // TypeError خام (ERR_INVALID_URL) لو كانت القيمة موجودة لكن مشوَّهة
    // (مثلاً مقتطف ناقص من رابط اتصال Supabase pooler، بلا "postgres://").
    // هذا الاستثناء الخام هو ما كان يُسقط build/"Collecting page data"
    // بأكمله لأي صفحة تُنفِّذ استعلاماً حقيقياً وقت البناء (/admin/reports
    // كانت أول صفحة تصله فترتيب الفحص) — بدل رسالة عربية واضحة قابلة
    // للالتقاط بنفس أسلوب حالة "غير معرَّف" أعلاه. لا نُغيّر هنا أي سلوك
    // حقيقي وقت التشغيل (استعلام حقيقي بـconnectionString صحيح لم يتأثر
    // إطلاقاً)، فقط نُترجم فشل الصياغة إلى نفس نوع الخطأ الآمن.
    throw new Error(
      `DATABASE_URL موجود لكن صيغته غير صالحة كرابط اتصال Postgres. تحقّق من القيمة فمتغيّرات البيئة (السبب الأصلي: ${
        err instanceof Error ? err.message : String(err)
      }).`
    );
  }

  cachedClient = client;
  if (process.env.NODE_ENV !== "production") {
    globalThis.__tayssirSql = client;
  }
  return client;
}

function buildClient(connectionString: string): SqlClient {
  const statementTimeout = readStatementTimeoutOption();
  return postgres(connectionString, {
    // 5 بلا متغيّر بيئة — نفس قيمة الإنتاج حرفياً. انظر readPoolMax.
    max: readPoolMax(),
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    // القيمة الافتراضية فـpostgres.js هي 30 ثانية — أطول من مهلة تنفيذ أي
    // Vercel Serverless Function عادةً (10 ثوان فـHobby). إذا كانت قاعدة
    // البيانات الحقيقية غير قابلة للوصول أو بطيئة (شبكة، Supabase متوقف
    // مؤقتاً، إعداد pooler خاطئ)، الاتصال يبقى معلَّقاً بصمت لحد 30 ثانية
    // بدل أن يفشل بسرعة — فتُقتَل الصفحة كاملة بـtimeout من Vercel نفسه قبل
    // ما يوصل الخطأ حتى إلى try/catch فـsafeQuery()، فلا تشتغل أبداً آلية
    // التراجع للبيانات المحلية الاحتياطية (preview) المصمَّمة أصلاً لهذه
    // الحالة بالضبط. مهلة قصيرة هنا تضمن فشلاً سريعاً يُفعِّل ذلك التراجع
    // فعلياً بدل صفحة معلَّقة بلا أي رد.
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    // اتصال طويل العمر خلف pooler بنمط transaction قد يُصبح «قديماً» بصمت
    // (الـpooler أعاد تدوير الاتصال الحقيقي خلفه، أو أُغلق من الطرف الآخر
    // بلا إشعار). بلا سقف لعمر الاتصال، تبقى نسخة الخادم الساخنة تحاول
    // استعمال اتصال ميت إلى الأبد. نصف ساعة سقف آمن: أطول بكثير من عمر أي
    // طلب فعلي، وأقصر بكثير من عمر نسخة lambda ساخنة.
    max_lifetime: MAX_LIFETIME_SECONDS,
    // ⚠️ connect_timeout يحدّ فقط من مدة الوصول إلى ReadyForQuery (فتح
    // اتصال TCP + مصافحة بروتوكول Postgres/المصادقة) — بمجرد اكتمال
    // الاتصال، لا يحدّ من مدة تنفيذ أي استعلام لاحق على الخادم إطلاقاً.
    // بدون statement_timeout، استعلام "عالق" بعد اتصال ناجح (تحميل زائد
    // على Supabase، pooler متأخر، قفل صف...) يبقى معلَّقاً بلا أي حد زمني
    // — لا يُرفَض ولا يُنفَّذ أبداً، فلا catch فـsafeQuery() ولا try/catch
    // الداخلي فـcatalog.ts يُفعَّلان أبداً، وتتعلَّق الصفحة كاملة حتى يقتلها
    // Vercel نفسه (أو لا يقتلها، فيبقى الزائر أمام صفحة معلَّقة بلا أي رد).
    // هذا اكتشاف حقيقي وسبب جذري مؤكَّد لعطل شبه-توقف الموقع فـProduction —
    // وليس افتراضاً: أُعيد إنتاجه محلياً (قفل ACCESS EXCLUSIVE يدوي على
    // جدول حقيقي أثناء طلب صفحة فعلي) قبل هذا الإصلاح، وتأكَّد أن الصفحة
    // تتعلَّق فعلاً بلا حد زمني، ثم تأكَّد أن هذا السطر وحده يحلّه.
    //
    // ⚠️ إضافة هذا الفرع: الإرسال صار مشروطاً (انظر
    // readStatementTimeoutOption). بلا متغيّر بيئة يُرسَل 8000 كما اليوم
    // بالحرف؛ وبـ`DB_STATEMENT_TIMEOUT_MS=off` لا يُرسَل المعامل إطلاقاً،
    // فنكتشف هل منفذ 5432 يقبله فعلاً أم أنه كان يُرفَض بصمت طوال الوقت.
    ...(statementTimeout.send
      ? { connection: { statement_timeout: statementTimeout.ms } }
      : {}),
    // postgres.js يُعِدّ (PREPARE) كل استعلام افتراضياً ويُخزِّن اسمه على
    // اتصال TCP الحالي ليعيد استعماله لاحقاً. هذا يفشل بشكل متقطّع خلف أي
    // pooler على مستوى المعاملة (transaction pooling، كما في Supabase
    // Transaction Pooler / PgBouncer pool_mode=transaction): الـpooler قد
    // يُبدِّل اتصال Postgres الحقيقي خلف نفس مقبس postgres.js بين معاملة
    // وأخرى، فيحاول العميل إعادة استعمال اسم prepared statement غير موجود
    // فعلاً على الاتصال الجديد → "prepared statement ... does not exist".
    // عطّلناه هنا نهائياً (غير مشروط بنوع الاتصال) لأنه لا ضرر منه على
    // اتصال مباشر أيضاً، وهذا هو الإعداد الموصى به رسمياً من توثيق
    // postgres.js وSupabase عند استعمال أي pooler بنمط transaction.
    prepare: false,
    types: {
      // postgres.js يُعيد bigint (المستعمل لكل الأعمدة id في هذا المشروع)
      // كنص افتراضياً تفادياً لفقدان الدقة مع أرقام ضخمة جداً. حجم بياناتنا
      // صغير (لن يقترب أبداً من حدود Number.MAX_SAFE_INTEGER)، لذا نحوّله
      // إلى رقم JS مباشرة ليطابق فعلياً أنواع TypeScript المُعلَنة (number)
      // بدل أن تكذب هذه الأنواع على القيمة الحقيقية وقت التنفيذ.
      bigint: {
        to: 20,
        from: [20],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  });
}

export const sql: SqlClient = new Proxy(function () {} as unknown as SqlClient, {
  apply(_target, _thisArg, args) {
    const client = getClient();
    // كل استعلام يمرّ من هنا (sql`...` في 47 ملفاً) يخرج مربوطاً بحد زمني
    // يُلغيه فعلياً بدل تركه يحجز اتصالاً إلى الأبد. أجزاء الاستعلام
    // (fragments) تمرّ من هنا أيضاً لكنها لا تُسلَّح لأنها لا تُنتظَر أبداً.
    return boundQueryLifetime(
      (client as unknown as (...a: unknown[]) => unknown)(...args)
    );
  },
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
