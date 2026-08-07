import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { listAdminAccounts } from "@/lib/queries/adminUsers";
import { CreateStaffForm } from "@/components/admin/CreateStaffForm";
import { AdminAccountRow } from "@/components/admin/AdminAccountRow";

export const dynamic = "force-dynamic";

export const metadata = { title: "المستخدمون والخدامة" };

export default async function AdminUsersPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  // هذه الصفحة مقصورة تماماً على Owner/Admin — Staff يُعاد توجيهه فوراً
  // قبل أي استعلام (نفس نمط كل صفحة إدارية مقصورة على Admin فهذا المشروع).
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const accounts = await listAdminAccounts();

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">المستخدمون والخدامة</h1>
      <p className="mt-1 text-xs text-neutral-500">
        Admin له كل الصلاحيات. Staff مقصور على الطلبات فقط (عرض، تغيير
        الحالة، طباعة البون، الاتصال وواتساب) — لا يرى ثمن الشراء ولا
        الأرباح ولا يدخل المنتجات أو الإعدادات أو هذه الصفحة.
      </p>

      <div className="mt-4">
        <CreateStaffForm />
      </div>

      <h2 className="mt-6 border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
        الحسابات الحالية ({accounts.length})
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {accounts.map((account) => (
          <AdminAccountRow key={account.id} account={account} isSelf={account.id === admin.id} />
        ))}
      </div>
    </div>
  );
}
