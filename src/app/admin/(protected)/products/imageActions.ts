"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { productImageAltTextSchema } from "@/lib/validation/product";
import {
  MAX_IMAGES_PER_PRODUCT,
  saveProductImageFile,
  deleteProductImageFile,
  validateImageFile,
} from "@/lib/storage/productImages";
import { getProductImagesAdmin, type AdminProductImage } from "@/lib/queries/adminProducts";

export type ImageActionState = {
  error: string | null;
  success?: boolean;
};

export async function uploadProductImage(
  productId: number,
  _prevState: ImageActionState,
  formData: FormData
): Promise<ImageActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "اختر صورة أولاً." };
  }

  const fileError = validateImageFile(file);
  if (fileError) return { error: fileError };

  const altTextRaw = formData.get("altText");
  const altTextParsed = productImageAltTextSchema.safeParse(altTextRaw || undefined);
  if (!altTextParsed.success) {
    return { error: altTextParsed.error.issues[0]?.message ?? "النص البديل غير صالح." };
  }

  const existing = await getProductImagesAdmin(productId);
  if (existing.length >= MAX_IMAGES_PER_PRODUCT) {
    return { error: `الحد الأقصى ${MAX_IMAGES_PER_PRODUCT} صور لكل منتج.` };
  }

  let storagePath: string;
  try {
    storagePath = await saveProductImageFile(productId, file);
  } catch {
    return { error: "تعذّر حفظ الصورة. حاول مرة أخرى." };
  }

  const nextSortOrder = existing.reduce((max, img) => Math.max(max, img.sort_order), 0) + 1;
  const isPrimary = existing.length === 0;

  await sql`
    insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
    values (${productId}, ${storagePath}, ${altTextParsed.data || null}, ${nextSortOrder}, ${isPrimary})
  `;

  revalidatePath(`/admin/products/${productId}`);
  return { error: null, success: true };
}

export async function deleteProductImage(
  imageId: number,
  productId: number
): Promise<{ error: string | null }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  const rows = await sql<AdminProductImage[]>`
    select id, product_id, storage_path, alt_text_ar, sort_order, is_primary
    from public.product_images where id = ${imageId} and product_id = ${productId}
  `;
  const image = rows[0];
  if (!image) return { error: null };

  await sql`delete from public.product_images where id = ${imageId} and product_id = ${productId}`;
  await deleteProductImageFile(image.storage_path);

  if (image.is_primary) {
    const remaining = await getProductImagesAdmin(productId);
    if (remaining.length > 0) {
      await sql`update public.product_images set is_primary = true where id = ${remaining[0].id}`;
    }
  }

  revalidatePath(`/admin/products/${productId}`);
  return { error: null };
}

export async function updateImageAltText(
  imageId: number,
  productId: number,
  _prevState: ImageActionState,
  formData: FormData
): Promise<ImageActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  const altTextParsed = productImageAltTextSchema.safeParse(formData.get("altText") || undefined);
  if (!altTextParsed.success) {
    return { error: altTextParsed.error.issues[0]?.message ?? "النص البديل غير صالح." };
  }

  await sql`
    update public.product_images set alt_text_ar = ${altTextParsed.data || null}
    where id = ${imageId} and product_id = ${productId}
  `;

  revalidatePath(`/admin/products/${productId}`);
  return { error: null, success: true };
}

export async function setPrimaryImage(
  imageId: number,
  productId: number
): Promise<{ error: string | null }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  await sql.begin(async (tx) => {
    await tx`update public.product_images set is_primary = false where product_id = ${productId}`;
    await tx`update public.product_images set is_primary = true where id = ${imageId} and product_id = ${productId}`;
  });

  revalidatePath(`/admin/products/${productId}`);
  return { error: null };
}

async function swapSortOrder(
  productId: number,
  imageId: number,
  direction: "up" | "down"
): Promise<{ error: string | null }> {
  const images = await getProductImagesAdmin(productId);
  const ordered = [...images].sort((a, b) => a.sort_order - b.sort_order);
  const index = ordered.findIndex((img) => img.id === imageId);
  if (index === -1) return { error: null };

  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= ordered.length) {
    return { error: null };
  }

  const current = ordered[index];
  const neighbor = ordered[neighborIndex];

  await sql.begin(async (tx) => {
    await tx`update public.product_images set sort_order = ${neighbor.sort_order} where id = ${current.id}`;
    await tx`update public.product_images set sort_order = ${current.sort_order} where id = ${neighbor.id}`;
  });

  revalidatePath(`/admin/products/${productId}`);
  return { error: null };
}

export async function moveImageUp(
  imageId: number,
  productId: number
): Promise<{ error: string | null }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };
  return swapSortOrder(productId, imageId, "up");
}

export async function moveImageDown(
  imageId: number,
  productId: number
): Promise<{ error: string | null }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };
  return swapSortOrder(productId, imageId, "down");
}
