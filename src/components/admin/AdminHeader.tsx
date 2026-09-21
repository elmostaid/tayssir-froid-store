"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAdmin } from "@/app/admin/actions";
import type { AdminRole } from "@/lib/auth/requireAdmin";

const ROLE_LABELS: Record<AdminRole, string> = {
  admin: "Admin",
  staff: "خدامة",
};

type NavItem = { href: string; label: string; adminOnly: boolean };

// نفس ترتيب الأقسام المطلوب فـلوحة الإدارة — Staff يرى "الطلبات" فقط
// (تحسين واجهة، وليس الحماية الفعلية: كل صفحة مقصورة على Admin تتحقق
// بنفسها من isOwnerAdmin() من جهة الخادم بغض النظر عن هذه القائمة).
const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "لوحة التحكم", adminOnly: true },
  { href: "/admin/orders", label: "الطلبات", adminOnly: false },
  { href: "/admin/products", label: "المنتجات", adminOnly: true },
  { href: "/admin/categories", label: "التصنيفات", adminOnly: true },
  { href: "/admin/featured", label: "الأكثر طلباً", adminOnly: true },
  { href: "/admin/customers", label: "الزبائن", adminOnly: true },
  { href: "/admin/reports", label: "التقارير والأرباح", adminOnly: true },
  { href: "/admin/expenses", label: "المصاريف", adminOnly: true },
  { href: "/admin/analytics", label: "تحليلات الزوّار", adminOnly: true },
  { href: "/admin/settings", label: "الإعدادات", adminOnly: true },
  { href: "/admin/users", label: "المستخدمون والخدامة", adminOnly: true },
];

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminHeader({
  role,
  email,
  iconBadge,
  menuBadge,
}: {
  role: AdminRole;
  email: string;
  // عقدتان يُصيّرهما الخادم ويبثّهما داخل <Suspense> — لا رقم يُنتظَر قبل
  // رسم الهيكل. غيابهما (null) هو الحالة الطبيعية حين لا توجد طلبات جديدة
  // أو حين يتعذّر عدّها؛ الفرق بينهما لا يُعرض للمستخدم كرقم.
  iconBadge?: React.ReactNode;
  menuBadge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open]);

  const items = NAV_ITEMS.filter((item) => role === "admin" || !item.adminOnly);
  const currentItem = [...items].reverse().find((item) => isItemActive(pathname, item.href));

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="فتح قائمة لوحة الإدارة"
          aria-expanded={open}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-700"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
          {iconBadge}
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-neutral-400">لوحة الإدارة</p>
          <p className="truncate text-base font-bold text-brand-turquoise-dark">
            {currentItem?.label ?? "لوحة الإدارة"}
          </p>
        </div>

        <form action={signOutAdmin}>
          <button
            type="submit"
            className="shrink-0 text-xs font-medium text-neutral-500 hover:text-red-600"
          >
            تسجيل الخروج
          </button>
        </form>
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex">
            <button
              type="button"
              aria-label="إغلاق القائمة"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <div className="relative me-auto ms-0 flex h-full w-[85vw] max-w-sm flex-col overflow-y-auto bg-white p-4 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-neutral-800">قائمة لوحة الإدارة</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="إغلاق"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <nav aria-label="أقسام لوحة الإدارة" className="mt-4 flex flex-col gap-1">
                {items.map((item) => {
                  const active = isItemActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-11 items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium ${
                        active
                          ? "bg-brand-turquoise-tint text-brand-turquoise-dark"
                          : "text-neutral-700 hover:bg-neutral-100"
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.href === "/admin/orders" ? menuBadge : null}
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-auto border-t border-neutral-200 pt-3 text-xs text-neutral-400">
                مسجَّل الدخول بصفة: {email} ({ROLE_LABELS[role]})
              </div>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
}
