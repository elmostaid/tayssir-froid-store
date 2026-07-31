import Link from "next/link";
import { signOutAdmin } from "@/app/admin/actions";

export function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/admin" className="text-base font-bold text-brand-turquoise-dark">
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
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-4xl px-4 py-6 text-xs text-neutral-400">
        مسجَّل الدخول بصفة: {email}
      </footer>
    </div>
  );
}
