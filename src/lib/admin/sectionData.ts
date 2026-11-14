/**
 * تحميل بيانات لوحة الإدارة: بأي عدد، وبأي مصير.
 *
 * هذا الملف يجيب عن سؤالين ظهرا معاً في تشخيص 2026-09-21، ولا ينفصلان:
 *
 * **كم استعلاماً في وقت واحد؟** مجمّع الاتصالات في db.ts سعته خمسة
 * (`max: 5`). وصفحة /admin/analytics كانت تُطلق ثمانية استعلامات متوازية،
 * وreports خمسة، ولوحة التحكّم خمسة — ثم يأتي فوقها استعلام الـlayout
 * (AdminShell.countNewOrders) الذي يُصيَّر بالتوازي مع الصفحة. فالطلب
 * الواحد كان يطلب تسعة اتصالات من مجمّع فيه خمسة. الفائض ينتظر في طابور
 * postgres.js، وكل محاولة فتح اتصال جديدة قد تكلّف خمس ثوانٍ كاملة
 * (`connect_timeout`) لأن الوصول إلى pooler سوبابيز نفسه يفشل بانتظام
 * (642 خطأ CONNECT_TIMEOUT في السجلّات). المنتظِر يبلغ عشر ثوانٍ فيُلغى
 * (57014) فتسقط الصفحة، أو يطول الانتظار حتى تقتل Vercel الدالّة بعد
 * خمس دقائق فيرى الهاتف ERR_CONNECTION_ABORTED.
 *
 * الحدّ ثلاثة لا خمسة: ثلاثة للصفحة + واحد للـlayout = أربعة، فيبقى في
 * المجمّع سلوت حر دائماً. والثمن أجزاء من الثانية — أثقل استعلام في
 * reports يستغرق 4.5 مللي ثانية، وأثقل استعلام في analytics 492.
 *
 * **وماذا لو فشل استعلام؟** لا يُستبدَل برقم. `safeQuery` تُعيد قيمة
 * احتياطية، وهي الصواب في واجهة المتجر حيث القائمة الفارغة أهون من صفحة
 * عطل. أما هنا فالقيمة الاحتياطية كذبة: «الربح الخام 0,00 درهم» ليست
 * درجة أقل من المعرفة، بل معلومة خاطئة يتّخذ صاحب المتجر عليها قراراً.
 * لذلك تُعيد `loadSection` نتيجة مُعلَّمة: إمّا قيمة حقيقية، وإمّا
 * `ok: false` يعرضه القسم صراحةً بوصفه تعذّراً — ولا رقم بينهما.
 */

/** نتيجة قسم: قيمة حقيقية، أو تعذُّر مُعلَن. لا ثالث لهما. */
export type SectionData<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * أقصى عدد استعلامات متوازية تُطلقها صفحة إدارة واحدة.
 *
 * ثلاثة من أصل خمسة في المجمّع، فيبقى واحد للـlayout وواحد احتياطياً.
 */
export const ADMIN_MAX_CONCURRENT_QUERIES = 3;

/**
 * يُنفِّذ استعلاماً ولا يرمي أبداً. الفشل يصير `{ ok: false }` يراه القسم
 * المعني وحده، فتبقى بقية الصفحة كما هي.
 *
 * يلتقط كل شيء عمداً — بما فيه `ServiceUnavailableError` التي تعيد
 * `safeQuery` رميها. ذاك السلوك صحيح في واجهة المتجر (متجر فارغ بـ200
 * أسوأ من 5xx صريح)، وخاطئ هنا: تعذُّر قسم في لوحة الإدارة لا يستحقّ
 * إسقاط الصفحة التي يعمل فيها صاحب المتجر.
 */
export async function loadSection<T>(
  run: () => Promise<T>,
  context: string
): Promise<SectionData<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    console.error(`loadSection: تعذّر تحميل القسم (${context})`, error);
    return { ok: false };
  }
}

type AnyTask = () => Promise<unknown>;

/**
 * يُنفِّذ المهام على دفعات لا تتجاوز `size` مهمة متوازية، ويحفظ ترتيب
 * النتائج وأنواعها كما لو كانت `Promise.all`.
 *
 * الترتيب مقصود: الدفعة الأولى تحمل ما تعرضه الصفحة أولاً، فيصل أهمّ ما
 * في الصفحة قبل تفاصيلها.
 */
export async function inBatches<const T extends readonly AnyTask[]>(
  tasks: T,
  size: number = ADMIN_MAX_CONCURRENT_QUERIES
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (let i = 0; i < tasks.length; i += size) {
    const batch = tasks.slice(i, i + size) as readonly AnyTask[];
    results.push(...(await Promise.all(batch.map((task) => task()))));
  }
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
