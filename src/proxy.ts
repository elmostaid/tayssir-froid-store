import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createTimeoutFetch, SUPABASE_AUTH_FETCH_TIMEOUT_MS } from "@/lib/supabase/fetchWithTimeout";

/**
 * proxy (اسم middleware الجديد في Next.js 16) يُحدِّث جلسة Supabase Auth
 * (يجدّد التوكن عند الحاجة) لصفحات /admin فقط. هذا لا يحمي أي شيء بحد
 * ذاته — الحماية الحقيقية في admin/layout.tsx وrequireAdmin() المستدعاة
 * داخل كل Server Action إداري.
 */
/**
 * هل هذا الطلب **جلبٌ مسبق** من موجّه Next، لا تنقّلاً حقيقياً؟
 *
 * الموجّه يُطلق طلب `.rsc` تلقائياً لكل `<Link>` يدخل الشاشة، قبل أن يضغط
 * أحدٌ شيئاً. وكل واحد منها يمرّ من هنا. ثلاثة ترويسات لأن Next غيّر
 * الترويسة عبر إصداراته، و`purpose: prefetch` هي ترويسة المتصفّح نفسه.
 */
function isRouterPrefetch(request: NextRequest): boolean {
  return (
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("x-purpose") === "prefetch"
  );
}

export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }

  /**
   * الجلب المسبق لا يُجدِّد جلسة.
   *
   * ## لماذا لا يُحذَف النداء كلّه بدل ذلك
   *
   * لأن هذا المكان هو **الوحيد** القادر على كتابة كوكي الجلسة المُجدَّدة.
   * `lib/supabase/server.ts` يلفّ `setAll` بـtry/catch لأن Server Component
   * لا يستطيع ضبط كوكي (وتعليقه يقول صراحةً: «proxy.ts يتكفّل بتحديث
   * الجلسة في هذه الحالة»). فلو حُذف النداء من هنا: ينتهي صلاحية access
   * token، فيُجدِّده `getAdminUser()` من داخل الصفحة، **ثم تضيع الكوكي
   * الجديدة** — ويعود المتصفّح في الطلب التالي بنفس refresh token
   * المستهلَك. ومع تدوير التوكنات في Supabase، الاستعمال المتكرّر لتوكن
   * مستهلَك يُبطل الجلسة كلها. أي أن الحذف يُخرج المدير من حسابه دورياً.
   *
   * ## ولماذا تخطّي الجلب المسبق آمن
   *
   * الجلب المسبق تخمينٌ لا يراه الزبون. حين ينقر فعلاً يقع طلب تنقّل
   * حقيقي يمرّ من هنا ويُجدِّد الجلسة كالعادة. والحماية نفسها لا تمرّ من
   * هنا إطلاقاً: `getAdminUser()` تفحص الجلسة **وجدول admin_profiles**
   * داخل كل صفحة وكل Server Action، وتفشل مغلقةً. هذا السطر لا يحمي شيئاً
   * (كما يقول التعليق أسفله أصلاً) — يُجدِّد فقط.
   *
   * القياس: فتح لائحة الطلبات (26 طلبية) كان يُطلق **50** نداء مصادقة نحو
   * Supabase قبل هذا، لأن كل رابط صفٍّ يُجلب مسبقاً.
   */
  if (isRouterPrefetch(request)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      // انظر fetchWithTimeout.ts — بدون هذا، تجديد الجلسة هنا عرضة لتعليق
      // غير محدود عند تدهور خدمة Supabase Auth، ما يُعلِّق كل طلب لأي صفحة
      // /admin/* (هذا middleware يُنفَّذ قبل أي شيء آخر).
      global: {
        fetch: createTimeoutFetch(SUPABASE_AUTH_FETCH_TIMEOUT_MS),
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  try {
    await supabase.auth.getUser();
  } catch (error) {
    // فشل/انتهاء مهلة هنا لا يُعطِّل الطلب — هذا middleware لا يحمي أي شيء
    // بحد ذاته (فقط تجديد اختياري للتوكن)، والحماية الحقيقية فـ
    // getAdminUser()/admin/layout.tsx تُعيد المحاولة من جهتها وتفشل بأمان
    // (fail closed) إن تعذّر التحقق فعلاً.
    console.error("proxy: تعذّر تحديث جلسة Supabase Auth", error);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
