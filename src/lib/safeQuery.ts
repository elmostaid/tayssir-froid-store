// حد زمني صارم شامل حول كل استعلام صفحات الواجهة العامة — دليل حقيقي على
// ضرورته (وليس افتراض): عطل 504 حقيقي متكرر على Vercel (FUNCTION_INVOCATION_
// TIMEOUT، مدة تنفيذ ~300 ثانية بالضبط = سقف Vercel الأقصى، "External APIs:
// No outgoing requests" يستبعد أي fetch خارجي) ظهر على أكثر من مسار
// (/category/[slug] ثم / لاحقاً) رغم وجود connect_timeout (5s) وstatement_
// timeout (8s) معاً على عميل postgres.js (راجع db.ts). يعني وجود فجوة
// حقيقية لا يحدّها أي منهما: الانتظار للحصول على اتصال فعلي من الـpooler
// نفسه (Supabase Transaction Pooler) — لا اتصال TCP فشل (connect_timeout
// كان سيحدّه) ولا استعلام بدأ تنفيذه فعلاً (statement_timeout كان سيحدّه).
//
// هذا السطر لا يحل سبب الانتظار نفسه (يحتاج فحص نوع الـpooler وحد اتصالاته
// من لوحة Supabase مباشرة) — فقط يضمن أن safeQuery تسترجع القيمة الاحتياطية
// بسرعة معقولة دائماً مهما كان مصدر التعليق بالضبط، بدل تعليق الصفحة كاملة
// حتى يقتلها Vercel بعد 5 دقائق. أطول قليلاً من مجموع connect_timeout+
// statement_timeout (13 ثانية) لإعطاء تلك المهلات الداخلية فرصة تعمل أولاً
// إن كانت تعمل فعلاً، مع البقاء أقصر بكثير من سقف Vercel.
const QUERY_TIMEOUT_MS = 15000;

/**
 * يُنفِّذ استعلاماً ويُعيد قيمة احتياطية عند تعذّر الوصول لقاعدة البيانات
 * (فشل صريح) أو عند تعليقه أكثر من QUERY_TIMEOUT_MS (لا يستجيب أصلاً)، بدل
 * انهيار/تعليق الصفحة بالكامل. يُسجَّل الخطأ الحقيقي في سجلات الخادم فقط
 * (عبر console.error) ولا يُعرض أي تفصيل تقني للزائر أبداً.
 */
export async function safeQuery<T>(
  run: () => Promise<T>,
  fallback: T,
  context: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(`safeQuery: تجاوز الاستعلام المهلة القصوى (${QUERY_TIMEOUT_MS}ms) — (${context})`)
      );
    }, QUERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([run(), timeout]);
  } catch (error) {
    console.error(`safeQuery: تعذّر تنفيذ الاستعلام (${context})`, error);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
