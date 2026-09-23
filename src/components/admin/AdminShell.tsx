import { Suspense } from "react";
import type { AdminRole } from "@/lib/auth/requireAdmin";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { NewOrdersIconBadge, NewOrdersMenuBadge } from "@/components/admin/NewOrdersBadge";

/**
 * هيكل لوحة الإدارة — بلا أي استعلام في مساره الحرج.
 *
 * كان هنا `await safeQuery(countNewOrders)`، فيتوقّف رسم اللوحة كلها على
 * استعلام شارةٍ صغيرة، ويُضاف ذلك الاستعلام إلى استعلامات الصفحة في نفس
 * اللحظة (الـlayout والصفحة يُصيَّران بالتوازي) فيتجاوز المجموع سعة
 * المجمّع. صار العدّ داخل <Suspense>: الهيكل يُرسَل فوراً، والشارة تلحق.
 */
export function AdminShell({
  email,
  role,
  children,
}: {
  email: string;
  role: AdminRole;
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" className="min-h-screen bg-neutral-50">
      <AdminHeader
        role={role}
        email={email}
        iconBadge={
          <Suspense fallback={null}>
            <NewOrdersIconBadge />
          </Suspense>
        }
        menuBadge={
          <Suspense fallback={null}>
            <NewOrdersMenuBadge />
          </Suspense>
        }
      />
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
