import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { getAllCategoriesAdmin } from "@/lib/queries/adminCategories";
import { DeleteCategoryButton } from "@/components/admin/DeleteCategoryButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "التصنيفات",
};

export default async function AdminCategoriesPage() {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }

  const categories = await getAllCategoriesAdmin();
  const topLevel = categories.filter((c) => c.parent_id === null);
  const childrenOf = (parentId: number) =>
    categories.filter((c) => c.parent_id === parentId);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-800">التصنيفات</h1>
        <Link
          href="/admin/categories/new"
          className="rounded-full bg-brand-orange px-4 py-2 text-sm font-semibold text-white"
        >
          + تصنيف جديد
        </Link>
      </div>

      {topLevel.length === 0 && (
        <p className="mt-6 text-sm text-neutral-500">لا توجد تصنيفات بعد.</p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {topLevel.map((category) => (
          <div
            key={category.id}
            className="rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-neutral-800">
                  {category.name_ar}
                </span>
                {!category.is_active && (
                  <span className="mr-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                    مخفي
                  </span>
                )}
                <p className="text-xs text-neutral-500" dir="ltr">
                  {category.slug}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  href={`/admin/categories/${category.id}`}
                  className="text-xs font-medium text-brand-turquoise-dark hover:underline"
                >
                  تعديل
                </Link>
                <DeleteCategoryButton categoryId={category.id} />
              </div>
            </div>

            {childrenOf(category.id).length > 0 && (
              <ul className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
                {childrenOf(category.id).map((child) => (
                  <li
                    key={child.id}
                    className="flex items-center justify-between gap-2 pr-4"
                  >
                    <div>
                      <span className="text-sm text-neutral-700">
                        — {child.name_ar}
                      </span>
                      {!child.is_active && (
                        <span className="mr-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                          مخفي
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Link
                        href={`/admin/categories/${child.id}`}
                        className="text-xs font-medium text-brand-turquoise-dark hover:underline"
                      >
                        تعديل
                      </Link>
                      <DeleteCategoryButton categoryId={child.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
