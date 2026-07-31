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
