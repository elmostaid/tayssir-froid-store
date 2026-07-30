"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { categorySchema } from "@/lib/validation/category";
import { flattenZodErrors } from "@/lib/validation/zodErrors";
import {
  countChildCategories,
  countProductsInCategory,
  isSlugTakenByOtherCategory,
} from "@/lib/queries/adminCategories";

export type CategoryFormState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
};

function parseCategoryForm(formData: FormData) {
  const parentIdRaw = formData.get("parentId");
  return categorySchema.safeParse({
    nameAr: formData.get("nameAr"),
    nameFr: formData.get("nameFr") || undefined,
    slug: formData.get("slug"),
    parentId: parentIdRaw ? Number(parentIdRaw) : null,
    sortOrder: Number(formData.get("sortOrder") || 0),
    isActive: formData.get("isActive") === "on",
  });
}

export async function createCategory(
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };

  const parsed = parseCategoryForm(formData);
  if (!parsed.success) {
    return { error: "تحقق من البيانات المدخلة.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  if (await isSlugTakenByOtherCategory(parsed.data.slug)) {
    return {
      error: "هذا الرابط (slug) مستعمل من تصنيف آخر.",
      fieldErrors: { slug: "مستعمل من قبل" },
    };
  }

  await sql`
    insert into public.categories (slug, name_ar, name_fr, parent_id, sort_order, is_active)
    values (
      ${parsed.data.slug}, ${parsed.data.nameAr}, ${parsed.data.nameFr || null},
      ${parsed.data.parentId}, ${parsed.data.sortOrder}, ${parsed.data.isActive}
    )
  `;

  revalidatePath("/admin/categories");
  redirect("/admin/categories");
}

export async function updateCategory(
  categoryId: number,
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };

  const parsed = parseCategoryForm(formData);
  if (!parsed.success) {
    return { error: "تحقق من البيانات المدخلة.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  if (parsed.data.parentId === categoryId) {
    return { error: "لا يمكن أن يكون التصنيف تابعاً لنفسه." };
  }

  if (await isSlugTakenByOtherCategory(parsed.data.slug, categoryId)) {
    return {
      error: "هذا الرابط (slug) مستعمل من تصنيف آخر.",
      fieldErrors: { slug: "مستعمل من قبل" },
    };
  }

  await sql`
    update public.categories set
      slug = ${parsed.data.slug},
      name_ar = ${parsed.data.nameAr},
      name_fr = ${parsed.data.nameFr || null},
      parent_id = ${parsed.data.parentId},
      sort_order = ${parsed.data.sortOrder},
      is_active = ${parsed.data.isActive}
    where id = ${categoryId}
  `;

  revalidatePath("/admin/categories");
  redirect("/admin/categories");
}

export async function deleteCategory(categoryId: number): Promise<{ error: string | null }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };

  const [productCount, childCount] = await Promise.all([
    countProductsInCategory(categoryId),
    countChildCategories(categoryId),
  ]);

  if (productCount > 0) {
    return {
      error: `لا يمكن حذف هذا التصنيف لأنه يحتوي ${productCount} منتج(ات). أخفِه بدل حذفه إن أردت.`,
    };
  }
  if (childCount > 0) {
    return {
      error: `لا يمكن حذف هذا التصنيف لأنه يحتوي ${childCount} تصنيفاً فرعياً. احذفها أو انقلها أولاً.`,
    };
  }

  await sql`delete from public.categories where id = ${categoryId}`;
  revalidatePath("/admin/categories");
  return { error: null };
}
