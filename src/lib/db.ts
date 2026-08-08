import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

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

  const client = postgres(connectionString, {
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

  cachedClient = client;
  if (process.env.NODE_ENV !== "production") {
    globalThis.__tayssirSql = client;
  }
  return client;
}

export const sql: SqlClient = new Proxy(function () {} as unknown as SqlClient, {
  apply(_target, _thisArg, args) {
    const client = getClient();
    return (client as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
