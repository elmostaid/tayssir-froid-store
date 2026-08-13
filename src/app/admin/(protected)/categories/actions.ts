"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
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
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

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
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

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

// نشر/إخفاء سريع من قائمة التصنيفات (بدل فتح فورم التعديل الكامل) — يُعيد
// استعمال نفس عمود is_active الموجود أصلاً (لا حقل جديد). التصنيف المخفي
// يختفي فوراً من كل واجهات الموقع العامة (getCategories فـcatalog.ts تشترط
// is_active=true أصلاً)، ولا يمسّ أي منتج أو تصنيف آخر. revalidatePath هنا
// دفاعي فقط (الصفحات المتأثرة أصلاً force-dynamic بلا cache دائم)، عدا
// sitemap.xml الذي كان يُبنى ثابتاً (انظر إصلاحه فsitemap.ts) فيحتاجه فعلاً.
export async function toggleCategoryVisibility(
  categoryId: number,
  nextIsActive: boolean
): Promise<{ error: string | null }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  const rows = await sql<{ slug: string }[]>`
    update public.categories set is_active = ${nextIsActive}
    where id = ${categoryId}
    returning slug
  `;
  if (!rows[0]) return { error: "التصنيف غير موجود." };

  revalidatePath("/admin/categories");
  revalidatePath("/");
  revalidatePath(`/category/${rows[0].slug}`);
  revalidatePath("/sitemap.xml");
  return { error: null };
}

export async function deleteCategory(categoryId: number): Promise<{ error: string | null }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

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
