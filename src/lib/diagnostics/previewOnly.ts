/**
 * قفل البيئة لمسار التشخيص: يعمل على معاينة المشروع المعزول وحده.
 *
 * ثلاث طبقات مستقلّة، وكل واحدة تكفي وحدها للرفض — لأن الشرط المطلوب ليس
 * «لا يظهر رابطه في الإنتاج» بل «**يُرفَض تشغيله** في الإنتاج حتى لو وصل
 * إليه طلب مباشر»:
 *
 *  1. `VERCEL_ENV === "production"` → رفض فوري. هذا هو النشر الإنتاجي
 *     الحقيقي بتعريف Vercel نفسها، لا بتخميننا.
 *  2. أي نشر على Vercel (معاينة كانت أو غيرها) يجب أن يكون متّصلاً بمشروع
 *     Supabase المعزول بعينه. المعرّف أدناه ليس سرّاً — يظهر كما هو في
 *     NEXT_PUBLIC_SUPABASE_URL داخل HTML كل صفحة — لكنه قفل حقيقي: لو
 *     بُدِّل متغيّر البيئة يوماً إلى مشروع آخر، يسكت هذا المسار من تلقائه
 *     بدل أن يُشغِّل استعلامات ثقيلة على قاعدة لا نعرفها.
 *  3. بناء إنتاجي خارج Vercel (NODE_ENV=production بلا VERCEL_ENV) → رفض.
 *     لا يوجد سبب مشروع لتشغيل التشخيص في بناء إنتاجي مستقلّ.
 *
 * التطوير المحلي (لا VERCEL_ENV ولا NODE_ENV=production) مسموح: هناك تُكتَب
 * الاختبارات وتُجرَّب القياسات على قاعدة محلية معزولة.
 */

/** مشروع Supabase المخصَّص للمعاينة — معرّف عام يظهر في كل صفحة. */
export const ISOLATED_PREVIEW_PROJECT_REF = "zgdjmeigdbgxdxwixnfl";

/**
 * فقط المتغيّرات التي يقرأها هذا القفل. نوع ضيّق مقصود بدل
 * `NodeJS.ProcessEnv`: الأخير يشترط NODE_ENV فيُجبر كل اختبار على تمرير
 * بيئة كاملة، ولا فائدة من ذلك هنا.
 */
export type DiagnosticsEnv = {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type PreviewOnlyVerdict =
  | { allowed: true; environment: string }
  | { allowed: false; reason: string };

/** يستخرج معرّف مشروع Supabase من رابطه العام، بلا أي سرّ. */
export function supabaseProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    const [first] = hostname.split(".");
    return first || null;
  } catch {
    return null;
  }
}

export function previewOnlyVerdict(
  env: DiagnosticsEnv = process.env
): PreviewOnlyVerdict {
  const vercelEnv = env.VERCEL_ENV;

  if (vercelEnv === "production") {
    return { allowed: false, reason: "نشر إنتاجي — التشخيص معطَّل بنيوياً." };
  }

  if (vercelEnv) {
    const ref = supabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
    if (ref !== ISOLATED_PREVIEW_PROJECT_REF) {
      return {
        allowed: false,
        reason: "هذه المعاينة غير متّصلة بمشروع Supabase المعزول — التشخيص معطَّل.",
      };
    }
    return { allowed: true, environment: vercelEnv };
  }

  if (env.NODE_ENV === "production") {
    return { allowed: false, reason: "بناء إنتاجي خارج Vercel — التشخيص معطَّل." };
  }

  return { allowed: true, environment: "development" };
}
