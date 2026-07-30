/**
 * يُنفِّذ استعلاماً ويُعيد قيمة احتياطية عند تعذّر الوصول لقاعدة البيانات،
 * بدل انهيار الصفحة بالكامل. يُسجَّل الخطأ الحقيقي في سجلات الخادم فقط
 * (عبر console.error) ولا يُعرض أي تفصيل تقني للزائر أبداً.
 */
export async function safeQuery<T>(
  run: () => Promise<T>,
  fallback: T,
  context: string
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`safeQuery: تعذّر تنفيذ الاستعلام (${context})`, error);
    return fallback;
  }
}
