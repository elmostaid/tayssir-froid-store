import { countNewOrders } from "@/lib/queries/adminOrders";
import { safeQuery } from "@/lib/safeQuery";
import type { AdminRole } from "@/lib/auth/requireAdmin";
import { AdminHeader } from "@/components/admin/AdminHeader";

export async function AdminShell({
  email,
  role,
  children,
}: {
  email: string;
  role: AdminRole;
  children: React.ReactNode;
}) {
  const newOrdersCount = await safeQuery(() => countNewOrders(), 0, "AdminShell.countNewOrders");

  return (
    <div dir="rtl" className="min-h-screen bg-neutral-50">
      <AdminHeader role={role} email={email} newOrdersCount={newOrdersCount} />
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
