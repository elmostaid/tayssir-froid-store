import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { getAllCategoriesAdmin } from "@/lib/queries/adminCategories";
import { ProductForm } from "@/components/admin/ProductForm";
import { createProduct } from "@/app/admin/(protected)/products/actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "منتج جديد",
};

export default async function NewProductPage() {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }

  const categories = await getAllCategoriesAdmin();

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">منتج جديد</h1>
      <div className="mt-4">
        <ProductForm action={createProduct} categories={categories} mode="create" />
      </div>
    </div>
  );
}
