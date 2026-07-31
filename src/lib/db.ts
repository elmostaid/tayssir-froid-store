import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

// يبقى الموقع قادراً على البناء والعمل بدون DATABASE_URL (مثلاً معاينة
// Vercel بدون قاعدة بيانات) عبر خدمة بيانات محلية ثابتة — انظر
// src/lib/queries/catalog.ts وsettings.ts. لهذا لا نرمي خطأ هنا عند غياب
// المتغير؛ الرمي يحدث فقط إذا استُعمل sql فعلياً بدونه (لوحة الإدارة أو
// إنشاء الطلبات، غير المطلوبتين في وضع المعاينة بدون قاعدة بيانات).
export const isDatabaseConfigured = Boolean(connectionString);

// نتفادى فتح اتصال جديد بقاعدة البيانات مع كل إعادة تحميل ساخنة (hot reload)
// أثناء التطوير عبر تخزين العميل في global.
declare global {
  var __tayssirSql: ReturnType<typeof postgres> | undefined;
}

function createSql() {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL غير معرَّف. أضفه في ملف .env.local (انظر .env.example للتفاصيل)."
    );
  }

  return (
    globalThis.__tayssirSql ??
    postgres(connectionString, {
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
    })
  );
}

export const sql = connectionString
  ? createSql()
  : (undefined as unknown as ReturnType<typeof postgres>);

if (connectionString && process.env.NODE_ENV !== "production") {
  globalThis.__tayssirSql = sql;
}
