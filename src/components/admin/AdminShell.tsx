import Link from "next/link";
import { signOutAdmin } from "@/app/admin/actions";
import { countNewOrders } from "@/lib/queries/adminOrders";
import { safeQuery } from "@/lib/safeQuery";
import type { AdminRole } from "@/lib/auth/requireAdmin";

const ROLE_LABELS: Record<AdminRole, string> = {
  admin: "Admin",
  staff: "خدامة",
};

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

  // Staff لا يرى فـالتنقّل إلا "الطلبات" — هذا فقط لتحسين تجربة الاستعمال
  // (إخفاء روابط لا يقدر يفتحها أصلاً)، وليس هو الحماية الفعلية: كل صفحة
  // وServer Action مقصورة على Admin تتحقق بنفسها من isOwnerAdmin() من جهة
  // الخادم بغض النظر عمّا يُعرَض هنا (انظر requireAdmin.ts).
  const homeHref = role === "admin" ? "/admin" : "/admin/orders";

  return (
    <div dir="rtl" className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href={homeHref} className="text-base font-bold text-brand-turquoise-dark">
            لوحة الإدارة
          </Link>
          <form action={signOutAdmin}>
            <button
              type="submit"
              className="text-xs font-medium text-neutral-500 hover:text-red-600"
            >
              تسجيل الخروج
            </button>
          </form>
        </div>
        <nav className="mx-auto flex max-w-4xl gap-2 overflow-x-auto px-4 pb-3 text-sm">
          {role === "admin" && (
            <>
              <Link
                href="/admin/categories"
                className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:border-brand-turquoise hover:text-brand-turquoise-dark"
              >
                التصنيفات
              </Link>
              <Link
                href="/admin/products"
                className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:border-brand-turquoise hover:text-brand-turquoise-dark"
              >
                المنتجات
              </Link>
            </>
          )}
          <Link
            href="/admin/orders"
            className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:border-brand-turquoise hover:text-brand-turquoise-dark"
          >
            الطلبات
            {newOrdersCount > 0 && (
              <span className="ms-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-orange px-1 text-xs font-semibold text-white">
                {newOrdersCount}
              </span>
            )}
          </Link>
          {role === "admin" && (
            <>
              <Link
                href="/admin/customers"
                className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:border-brand-turquoise hover:text-brand-turquoise-dark"
              >
                الزبائن
              </Link>
              <Link
                href="/admin/reports"
                className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:border-brand-turquoise hover:text-brand-turquoise-dark"
              >
                التقارير
              </Link>
              <Link
                href="/admin/settings"
                className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:border-brand-turquoise hover:text-brand-turquoise-dark"
              >
                الإعدادات
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-4xl px-4 py-6 text-xs text-neutral-400">
        مسجَّل الدخول بصفة: {email} ({ROLE_LABELS[role]})
      </footer>
    </div>
  );
}
