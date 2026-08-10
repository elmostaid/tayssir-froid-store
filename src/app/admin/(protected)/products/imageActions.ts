"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { productImageAltTextSchema } from "@/lib/validation/product";
import {
  MAX_IMAGES_PER_PRODUCT,
  ALLOWED_IMAGE_TYPES,
  EXT_BY_TYPE,
  saveProductImageFile,
  deleteProductImageFile,
  validateImageFile,
  isRemoteStorageConfigured,
  StorageNotConfiguredError,
} from "@/lib/storage/productImages";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getProductImagesAdmin, type AdminProductImage } from "@/lib/queries/adminProducts";

const PRODUCT_IMAGES_BUCKET = "product-images";

export type ImageActionState = {
  error: string | null;
  success?: boolean;
};

// رسالة واضحة وصادقة عند عدم تهيئة تخزين الصور السحابي (Supabase Storage)
// بدل رسالة "حاول مرة أخرى" المضلِّلة — إعادة المحاولة لن تنجح أبداً فهذه
// الحالة، لأن Vercel لا يسمح بالكتابة على نظام الملفات المحلي.
function saveFailureMessage(err: unknown): string {
  if (err instanceof StorageNotConfiguredError) {
    return "رفع الصور غير مُفعَّل حالياً على الإنتاج (تخزين Supabase غير مُهيَّأ). تواصل مع المطوّر لإكمال الإعداد.";
  }
  return "تعذّر حفظ الصورة. حاول مرة أخرى.";
}

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

  // نفس الترتيب الآمن المعتمد فـreplacePrimaryImage: رفع الملف أولاً، وعند
  // فشل تحديث قاعدة البيانات نحذف الملف المرفوع تواً فوراً (لا صور يتيمة).
  let storagePath: string;
  try {
    storagePath = await saveProductImageFile(productId, file);
  } catch (err) {
    return { error: saveFailureMessage(err) };
  }

  const nextSortOrder = existing.reduce((max, img) => Math.max(max, img.sort_order), 0) + 1;
  const isPrimary = existing.length === 0;

  try {
    await sql`
      insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
      values (${productId}, ${storagePath}, ${altTextParsed.data || null}, ${nextSortOrder}, ${isPrimary})
    `;
  } catch {
    await deleteProductImageFile(storagePath).catch(() => {});
    return { error: "تعذّر حفظ الصورة فقاعدة البيانات. لم يتغيّر شيء." };
  }

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
  return { error: null, success: true };
}

export type UploadTargetState = {
  error: string | null;
  uploadUrl?: string;
  token?: string;
  objectPath?: string;
};

// اسم الكائن دائماً {productId}/{UUID}.{ext} — نفس اتفاقية saveProductImageFile
// بالضبط. التحقق منه صارماً فـcommitPrimaryImage أدناه (وليس تخميناً) هو ما
// يمنع أي عميل من تمرير مسار كائن تعسفي/يخص منتجاً آخر.
const UPLOAD_OBJECT_PATH_RE =
  /^(\d+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;

/**
 * تغيير الصورة الرئيسية للمنتج، بدون تمرير الملف عبر Server Action/Vercel
 * إطلاقاً: المتصفح يرفع الصورة مباشرة إلى Supabase Storage باستعمال رابط
 * رفع موقَّع (signed upload URL) تولّده هذه الدالة، ثم commitPrimaryImage
 * أدناه يُحدِّث فقط storage_path بعد نجاح الرفع الفعلي. هذا يتفادى حد حجم
 * body الافتراضي لـServer Actions (1MB) وحد payload لدوال Vercel (4.5MB)،
 * اللذين كانا يُسقطان /admin/products بـServer Error عند اختيار صورة هاتف
 * حقيقية أكبر من ميغابايت واحد.
 */
export async function createPrimaryImageUploadTarget(
  productId: number,
  contentType: string
): Promise<UploadTargetState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  if (!isRemoteStorageConfigured()) {
    return { error: saveFailureMessage(new StorageNotConfiguredError()) };
  }

  const ext = ALLOWED_IMAGE_TYPES.includes(contentType as (typeof ALLOWED_IMAGE_TYPES)[number])
    ? EXT_BY_TYPE[contentType]
    : null;
  if (!ext) {
    return { error: "صيغة الصورة غير مدعومة. استعمل JPG أو PNG أو WEBP فقط." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { error: "تعذّر الاتصال بمخزن الصور." };
  }

  const objectPath = `${productId}/${randomUUID()}.${ext}`;
  const { data, error } = await client.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .createSignedUploadUrl(objectPath);
  if (error || !data) {
    return { error: "تعذّر تحضير رفع الصورة. حاول مرة أخرى." };
  }

  return { error: null, uploadUrl: data.signedUrl, token: data.token, objectPath: data.path };
}

/**
 * الخطوة الثانية بعد نجاح الرفع المباشر من المتصفح إلى Supabase Storage:
 * تتحقق فعلياً أن الكائن موجود بالفعل فالتخزين (وليس فقط أن المتصفح ادّعى
 * النجاح)، ثم تُحدِّث storage_path للصورة الرئيسية فقط. لا ملف يمرّ هنا
 * إطلاقاً — productId وobjectPath فقط، وكلاهما نص قصير جداً.
 *
 * نفس الترتيب الآمن السابق: تحديث قاعدة البيانات فقط بعد التأكد من الرفع.
 * الصورة/الملف القديم لا يُحذف ولا يُلمس أبداً — مقصود.
 */
export async function commitPrimaryImage(
  productId: number,
  objectPath: string
): Promise<ImageActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  const match = UPLOAD_OBJECT_PATH_RE.exec(objectPath);
  if (!match || Number(match[1]) !== productId) {
    return { error: "مسار الصورة غير صالح." };
  }

  if (!isRemoteStorageConfigured()) {
    return { error: saveFailureMessage(new StorageNotConfiguredError()) };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { error: "تعذّر الاتصال بمخزن الصور." };
  }

  // تأكيد أن الكائن مرفوع فعلاً فالتخزين قبل تحديث القاعدة — بلا هذا قد
  // نُشير لصورة غير موجودة إن ادّعى المتصفح النجاح خطأً أو تلاعب أحد بالمسار.
  const filename = objectPath.slice(objectPath.indexOf("/") + 1);
  const { data: listing, error: listError } = await client.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .list(String(productId), { search: filename });
  if (listError || !listing?.some((entry) => entry.name === filename)) {
    return { error: "تعذّر التأكد من رفع الصورة. حاول مرة أخرى." };
  }

  const { data: publicUrlData } = client.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(objectPath);
  const newStoragePath = publicUrlData.publicUrl;

  const existing = await getProductImagesAdmin(productId);
  const currentPrimary = existing.find((img) => img.is_primary) ?? null;

  try {
    if (currentPrimary) {
      await sql`
        update public.product_images
        set storage_path = ${newStoragePath}
        where id = ${currentPrimary.id} and product_id = ${productId}
      `;
    } else {
      await sql`
        insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
        values (${productId}, ${newStoragePath}, null, 1, true)
      `;
    }
  } catch {
    return { error: "تعذّر تحديث الصورة فقاعدة البيانات. لم يتغيّر شيء." };
  }

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
  // الواجهة الأمامية (صفحة المنتج، صفحة التصنيف، الرئيسية...) كلها
  // force-dynamic أصلاً فلا تحتاج revalidatePath لتُحدَّث فعلياً — لكن نُنعشها
  // بنفس النمط المعتمد فـsettings/actions.ts (revalidatePath("/", "layout"))
  // لتفادي أي عرض من ذاكرة تنقّل جانب العميل (client-side router cache).
  revalidatePath("/", "layout");

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
  // السجل حُذف فعلياً من القاعدة بنجاح — فشل حذف الملف نفسه (تخزين غير
  // مُهيَّأ، أو أي خطأ تخزين آخر) يبقى ملفاً يتيماً غير ضار، ولا يجب أبداً
  // أن يُفشل الإجراء بعد نجاح الحذف الفعلي من القاعدة.
  await deleteProductImageFile(image.storage_path).catch(() => {});

  if (image.is_primary) {
    const remaining = await getProductImagesAdmin(productId);
    if (remaining.length > 0) {
      await sql`update public.product_images set is_primary = true where id = ${remaining[0].id}`;
    }
  }

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
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
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
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
