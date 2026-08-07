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
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) {
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
