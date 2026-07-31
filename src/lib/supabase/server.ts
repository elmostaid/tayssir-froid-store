import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * عميل Supabase لاستعماله داخل Server Components وServer Actions.
 * لا يُستدعى إلا بعد التأكد من isSupabaseConfigured().
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // يحدث عند الاستدعاء من Server Component عادي (قراءة فقط) بدل
            // Server Action/Route Handler. proxy.ts يتكفّل بتحديث الجلسة
            // في هذه الحالة، فلا داعي لأي معالجة إضافية هنا.
          }
        },
      },
    }
  );
}
