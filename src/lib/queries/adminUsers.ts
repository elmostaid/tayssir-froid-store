import { sql } from "@/lib/db";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import type { AdminRole } from "@/lib/auth/requireAdmin";

// استعلامات إدارة حسابات لوحة الإدارة (admin_profiles) — /admin/users
// حصرياً، مقصورة على Owner/Admin. البريد الإلكتروني لا يُخزَّن فـ
// admin_profiles (فقط فـauth.users الخاص بـSupabase)، فيُجلَب بأفضل مجهود
// عبر Supabase Auth Admin API (service role) — الطريقة الصحيحة الموثَّقة
// من Supabase للوصول لبيانات مستخدم من كود الخادم، بدل استعلام auth.users
// مباشرة (تفصيل داخلي غير مضمون الاستقرار). إن لم يكن SUPABASE_SERVICE_
// ROLE_KEY مضبوطاً، تبقى القائمة تعمل لكن بلا بريد إلكتروني (fallback آمن).

export type AdminAccount = {
  id: string;
  fullName: string | null;
  role: AdminRole;
  email: string | null;
  disabledAt: string | null;
  createdAt: string;
};

export async function listAdminAccounts(): Promise<AdminAccount[]> {
  const rows = await sql<
    { id: string; full_name: string | null; role: string; disabled_at: string | null; created_at: string }[]
  >`
    select id, full_name, role, disabled_at, created_at
    from public.admin_profiles
    order by created_at asc
  `;

  const emailById = new Map<string, string | null>();
  const serviceClient = getSupabaseServiceRoleClient();
  if (serviceClient) {
    await Promise.all(
      rows.map(async (row) => {
        try {
          const { data } = await serviceClient.auth.admin.getUserById(row.id);
          emailById.set(row.id, data.user?.email ?? null);
        } catch {
          emailById.set(row.id, null);
        }
      })
    );
  }

  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    role: r.role === "admin" ? "admin" : "staff",
    email: emailById.get(r.id) ?? null,
    disabledAt: r.disabled_at,
    createdAt: r.created_at,
  }));
}

// عدد حسابات admin النشطة (غير المعطَّلة) — أساس حماية "آخر Admin" فـ
// actions.ts (لا يجوز أن يصل هذا العدد للصفر أبداً عبر تخفيض/تعطيل/حذف).
export async function countActiveAdmins(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from public.admin_profiles
    where role = 'admin' and disabled_at is null
  `;
  return row?.count ?? 0;
}
