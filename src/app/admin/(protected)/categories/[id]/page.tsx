import { notFound, redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { getAllCategoriesAdmin, getCategoryByIdAdmin } from "@/lib/queries/adminCategories";
import { CategoryForm } from "@/components/admin/CategoryForm";
import { updateCategory } from "@/app/admin/(protected)/categories/actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "تعديل تصنيف",
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditCategoryPage({ params }: Props) {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }

  const { id } = await params;
  const categoryId = Number(id);

  if (!Number.isInteger(categoryId)) {
    notFound();
  }

  const [category, categories] = await Promise.all([
    getCategoryByIdAdmin(categoryId),
    getAllCategoriesAdmin(),
  ]);

  if (!category) {
    notFound();
  }

  const boundAction = updateCategory.bind(null, categoryId);

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">تعديل: {category.name_ar}</h1>
      <div className="mt-4">
        <CategoryForm
          action={boundAction}
          category={category}
          parentOptions={categories}
          mode="edit"
        />
      </div>
    </div>
  );
}
