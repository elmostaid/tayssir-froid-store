import { sql } from "@/lib/db";

// استعلامات لوحة الإدارة فقط — تُظهر كل التصنيفات بغض النظر عن is_active
// (بخلاف catalog_categories العامة). لا تُستعمل خارج مسارات /admin.

export type AdminCategory = {
  id: number;
  slug: string;
  name_ar: string;
  name_fr: string | null;
  description_ar: string | null;
  parent_id: number | null;
  sort_order: number;
  is_active: boolean;
};

export async function getAllCategoriesAdmin(): Promise<AdminCategory[]> {
  return sql<AdminCategory[]>`
    select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order, is_active
    from public.categories
    order by parent_id nulls first, sort_order asc, name_ar asc
  `;
}

export async function getCategoryByIdAdmin(id: number): Promise<AdminCategory | null> {
  const rows = await sql<AdminCategory[]>`
    select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order, is_active
    from public.categories where id = ${id} limit 1
  `;
  return rows[0] ?? null;
}

export async function countProductsInCategory(categoryId: number): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from public.products where category_id = ${categoryId}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function countChildCategories(categoryId: number): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from public.categories where parent_id = ${categoryId}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function isSlugTakenByOtherCategory(
  slug: string,
  excludeId?: number
): Promise<boolean> {
  const rows =
    excludeId !== undefined
      ? await sql`select id from public.categories where slug = ${slug} and id != ${excludeId} limit 1`
      : await sql`select id from public.categories where slug = ${slug} limit 1`;
  return rows.length > 0;
}
