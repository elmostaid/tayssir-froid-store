import { sql } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type AdminUser = { id: string; email: string };

/**
 * الحماية الحقيقية للوحة الإدارة: تتحقق من جلسة Supabase Auth الحالية، ثم
 * تؤكد أن صاحبها موجود فعلاً في admin_profiles (وليس أي مستخدم Supabase
 * مسجَّل). تُستدعى من admin/layout.tsx (للعرض) **ومن كل Server Action
 * إداري على حدة** (لأن الحماية يجب أن تكون من جهة الخادم دائماً، لا تعتمد
 * فقط على إخفاء رابط في الواجهة).
 *
 * بدون NEXT_PUBLIC_SUPABASE_URL/ANON_KEY، تُعيد null دائماً — لا يوجد أي
 * باب دخول بديل يعمل بدون Supabase حقيقي.
 */
export async function getAdminUser(): Promise<AdminUser | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const rows = await sql<{ id: string }[]>`
    select id from public.admin_profiles where id = ${user.id} limit 1
  `;

  if (rows.length === 0) {
    return null;
  }

  return { id: user.id, email: user.email ?? "" };
}
