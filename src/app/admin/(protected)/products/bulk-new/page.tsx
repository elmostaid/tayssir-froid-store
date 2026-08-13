import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getAllCategoriesAdmin } from "@/lib/queries/adminCategories";
import { BulkProductAddForm } from "@/components/admin/BulkProductAddForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "إضافة مجموعة منتجات",
};

export default async function BulkNewProductsPage() {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }
  if (!isOwnerAdmin(admin)) {
    redirect("/admin/orders");
  }

  const categories = await getAllCategoriesAdmin();

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">إضافة مجموعة منتجات</h1>
      <p className="mt-1 text-sm text-neutral-500">
        اختر تصنيفاً واحداً، حدّد القيم المشتركة، ثم أضف كل منتج كسطر مستقل. SKU وslug يُولَّدان
        تلقائياً بلا تعارض. ثمن الشراء يبقى سرياً ولا يظهر للزبون أبداً.
      </p>
      <div className="mt-4">
        <BulkProductAddForm categories={categories} />
      </div>
    </div>
  );
}
