import { sql } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type AdminRole = "admin" | "staff";
export type AdminUser = { id: string; email: string; role: AdminRole };

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

  const rows = await sql<{ id: string; role: string; disabled_at: string | null }[]>`
    select id, role, disabled_at from public.admin_profiles where id = ${user.id} limit 1
  `;

  // حساب مُعطَّل (disabled_at غير NULL، انظر migration
  // 20260809000000_add_admin_profiles_disabled_at) يُعامَل تماماً كأنه غير
  // موجود إطلاقاً — نفس أثر عدم وجود صف بـadmin_profiles، بلا استثناء.
  if (rows.length === 0 || rows[0].disabled_at !== null) {
    return null;
  }

  // أي قيمة غير 'admin' بالضبط (بما فيها بيانات قديمة/غير متوقعة قبل قيد
  // admin_profiles_role_check) تُعامَل صراحة كـ"staff" — الدور الأقل
  // صلاحية (fail-closed)، وليس كخطأ يمنع الدخول بالكامل. الحساب الحقيقي
  // الوحيد المعروف حالياً role='admin' نصاً صريحاً (migration
  // 20260803020000)، فلن يتأثر بهذا الافتراضي أبداً.
  const role: AdminRole = rows[0].role === "admin" ? "admin" : "staff";

  return { id: user.id, email: user.email ?? "", role };
}

/**
 * true فقط لصاحب الحساب (Owner/Admin) — false لـstaff أو لزائر غير مسجَّل.
 * يُستعمل فـكل صفحة/Server Action مقصورة على الصلاحيات الكاملة: المنتجات
 * والمخزون وثمن الشراء، التصنيفات، الزبائن، الأرباح والتقارير، الإعدادات.
 * صفحات/إجراءات الطلبات (عرض، تغيير حالة، طباعة البون) لا تستعمل هذا الفحص
 * — متاحة لكل من getAdminUser() ترجع له مستخدماً (admin أو staff).
 */
export function isOwnerAdmin(admin: AdminUser | null): admin is AdminUser & { role: "admin" } {
  return admin !== null && admin.role === "admin";
}
