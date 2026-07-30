import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "لوحة التحكم",
};

export default async function AdminDashboardPage() {
  // فحص إضافي هنا (وليس فقط في admin/(protected)/layout.tsx) لأن Next.js
  // App Router يُنفّذ صفحة الطفل بغض النظر عن اختيار الـlayout الأب عرضها
  // من عدمه — الحماية الحقيقية يجب أن تكون في كل صفحة على حدة أيضاً.
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">لوحة التحكم</h1>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/admin/categories"
          className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-brand-turquoise"
        >
          <h2 className="text-base font-semibold text-neutral-800">التصنيفات</h2>
          <p className="mt-1 text-sm text-neutral-500">
            إضافة وتعديل التصنيفات والتصنيفات الفرعية
          </p>
        </Link>
        <Link
          href="/admin/products"
          className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-brand-turquoise"
        >
          <h2 className="text-base font-semibold text-neutral-800">المنتجات</h2>
          <p className="mt-1 text-sm text-neutral-500">
            إضافة وتعديل المنتجات، الأسعار، المخزون، والصور
          </p>
        </Link>
      </div>
    </div>
  );
}
