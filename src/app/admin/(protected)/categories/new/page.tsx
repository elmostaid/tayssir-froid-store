import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getAllCategoriesAdmin } from "@/lib/queries/adminCategories";
import { CategoryForm } from "@/components/admin/CategoryForm";
import { createCategory } from "@/app/admin/(protected)/categories/actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "تصنيف جديد",
};

export default async function NewCategoryPage() {
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
      <h1 className="text-xl font-bold text-neutral-800">تصنيف جديد</h1>
      <div className="mt-4">
        <CategoryForm action={createCategory} parentOptions={categories} mode="create" />
      </div>
    </div>
  );
}
