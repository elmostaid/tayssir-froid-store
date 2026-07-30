import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/admin/SupabaseNotConfigured";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return <SupabaseNotConfigured />;
  }

  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }

  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
