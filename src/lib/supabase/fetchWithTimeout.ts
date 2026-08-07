// مكتبة @supabase/supabase-js (ومن ورائها @supabase/ssr) لا تضبط أي مهلة
// افتراضية على استدعاءات fetch() الخاصة بها (auth.getUser() وغيرها) — طلب
// HTTP خارجي عالق (تدهور حقيقي فخدمة Supabase Auth نفسها، وليس قاعدة
// البيانات) كان يبقى معلَّقاً بلا أي حد زمني حتى يقتله Vercel نفسه
// (FUNCTION_INVOCATION_TIMEOUT بعد المهلة القصوى المضبوطة للدالة — 5 دقائق
// كاملة، مؤكَّد من Vercel Runtime Logs الحقيقية على Production). هذا نفس
// نوع الفجوة بالضبط التي كانت فـdb.ts (connect_timeout بدون statement_timeout)
// لكن على طبقة fetch الخاصة بـSupabase Auth بدل PostgreSQL.
//
// AbortController هنا يُلغي طلب HTTP الفعلي (يُغلق الاتصال فعلياً عبر
// إشارة الإلغاء التي يفهمها fetch نفسه) — بخلاف Promise.race الذي يكتفي
// بتجاهل نتيجة الطلب القديم بينما يبقى شغّالاً بالخلفية بلا أي فائدة ولا
// تحكّم حقيقي فيه.
export function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const externalSignal = init?.signal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
    });
  };
}

// 5 ثوانٍ كافية جداً لاستجابة طبيعية من Supabase Auth (عادة أقل من نصف
// ثانية)، وقصيرة بما يكفي لضمان فشل سريع محدود بدل انتظار مهلة الدالة
// القصوى على Vercel بالكامل.
export const SUPABASE_AUTH_FETCH_TIMEOUT_MS = 5000;
