import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

// حد زمني حقيقي لكل استعلام على مستوى العميل — أقصر من مهلة safeQuery
// (15 ثانية) حتى يعمل هذا أولاً دائماً، وأطول قليلاً من statement_timeout
// (8 ثوان) حتى لا يسبق مهلة الخادم في الحالة التي يعمل فيها الخادم فعلاً.
const QUERY_HARD_TIMEOUT_MS = 10000;

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

  const arm = () => {
    if (armed) return;
    armed = true;
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
    Reflect.apply(originalThen, pending, [disarm, disarm]);
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

  const connectionString = process.env.DATABASE_URL;
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
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    // القيمة الافتراضية فـpostgres.js هي 30 ثانية — أطول من مهلة تنفيذ أي
    // Vercel Serverless Function عادةً (10 ثوان فـHobby). إذا كانت قاعدة
    // البيانات الحقيقية غير قابلة للوصول أو بطيئة (شبكة، Supabase متوقف
    // مؤقتاً، إعداد pooler خاطئ)، الاتصال يبقى معلَّقاً بصمت لحد 30 ثانية
    // بدل أن يفشل بسرعة — فتُقتَل الصفحة كاملة بـtimeout من Vercel نفسه قبل
    // ما يوصل الخطأ حتى إلى try/catch فـsafeQuery()، فلا تشتغل أبداً آلية
    // التراجع للبيانات المحلية الاحتياطية (preview) المصمَّمة أصلاً لهذه
    // الحالة بالضبط. مهلة قصيرة هنا تضمن فشلاً سريعاً يُفعِّل ذلك التراجع
    // فعلياً بدل صفحة معلَّقة بلا أي رد.
    connect_timeout: 5,
    // اتصال طويل العمر خلف pooler بنمط transaction قد يُصبح «قديماً» بصمت
    // (الـpooler أعاد تدوير الاتصال الحقيقي خلفه، أو أُغلق من الطرف الآخر
    // بلا إشعار). بلا سقف لعمر الاتصال، تبقى نسخة الخادم الساخنة تحاول
    // استعمال اتصال ميت إلى الأبد. نصف ساعة سقف آمن: أطول بكثير من عمر أي
    // طلب فعلي، وأقصر بكثير من عمر نسخة lambda ساخنة.
    max_lifetime: 60 * 30,
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
    connection: {
      statement_timeout: 8000,
    },
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
