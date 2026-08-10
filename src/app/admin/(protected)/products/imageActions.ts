"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { productImageAltTextSchema } from "@/lib/validation/product";
import { ALLOWED_IMAGE_TYPES, EXT_BY_TYPE, MAX_IMAGES_PER_PRODUCT } from "@/lib/storage/imageValidation";
import { deleteProductImageFile, isRemoteStorageConfigured } from "@/lib/storage/productImages";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getProductImagesAdmin, type AdminProductImage } from "@/lib/queries/adminProducts";

const PRODUCT_IMAGES_BUCKET = "product-images";

export type ImageActionState = {
  error: string | null;
  success?: boolean;
};

// رسالة واضحة وصادقة عند عدم تهيئة تخزين الصور السحابي (Supabase Storage)
// بدل رسالة "حاول مرة أخرى" المضلِّلة — إعادة المحاولة لن تنجح أبداً فهذه
// الحالة، فلا مسار محلي بديل للرفع إطلاقاً (كل رفع صورة مباشر من المتصفح
// إلى Supabase Storage — راجع createImageUploadTarget أدناه).
function storageNotConfiguredMessage(): string {
  return "رفع الصور غير مُفعَّل حالياً على الإنتاج (تخزين Supabase غير مُهيَّأ). تواصل مع المطوّر لإكمال الإعداد.";
}

export type UploadTargetState = {
  error: string | null;
  uploadUrl?: string;
  token?: string;
  objectPath?: string;
};

// اسم الكائن دائماً {productId}/{UUID}.{ext} — التحقق منه صارماً فـ
// commitPrimaryImage/commitAdditionalImage أدناه (وليس تخميناً) هو ما يمنع
// أي عميل من تمرير مسار كائن تعسفي/يخص منتجاً آخر.
const UPLOAD_OBJECT_PATH_RE =
  /^(\d+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;

/**
 * تحضير رفع صورة (سواء الصورة الرئيسية أو صورة إضافية) بدون تمرير الملف
 * عبر Server Action/Vercel إطلاقاً: Server Action صغيرة (نص فقط — productId
 * ونوع الملف)، تُرجع رابط رفع موقَّع (signed upload URL) من Supabase
 * Storage. المتصفح يرفع binary الصورة مباشرة إلى هذا الرابط بعدها
 * (uploadToSignedUrl)، فلا حد حجم body لـServer Actions (1MB افتراضياً) ولا
 * حد payload لدوال Vercel (~4.5MB) يُطبَّق أبداً على الملف — كان هذا بالضبط
 * سبب سقوط /admin/products بـ"Body exceeded 1 MB limit" (413) عند اختيار
 * صورة هاتف حقيقية أكبر من ميغابايت واحد.
 */
export async function createImageUploadTarget(
  productId: number,
  contentType: string
): Promise<UploadTargetState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  if (!isRemoteStorageConfigured()) {
    return { error: storageNotConfiguredMessage() };
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

/** يتحقق أن objectPath مطابق تماماً لاتفاقية {productId}/{UUID}.{ext} — يرفض أي تلاعب أو مسار يخص منتجاً آخر. */
function validateObjectPathForProduct(objectPath: string, productId: number): boolean {
  const match = UPLOAD_OBJECT_PATH_RE.exec(objectPath);
  return Boolean(match) && Number(match![1]) === productId;
}

/**
 * يتأكد أن الكائن مرفوع فعلاً فالتخزين قبل أي تحديث لقاعدة البيانات — بلا
 * هذا قد نُشير لصورة غير موجودة إن ادّعى المتصفح النجاح خطأً (فشل شبكة
 * صامت) أو تلاعب أحد بالمسار.
 */
async function confirmObjectUploaded(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  productId: number,
  objectPath: string
): Promise<boolean> {
  const filename = objectPath.slice(objectPath.indexOf("/") + 1);
  const { data: listing, error } = await client.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .list(String(productId), { search: filename });
  return !error && Boolean(listing?.some((entry) => entry.name === filename));
}

/**
 * تغيير الصورة الرئيسية للمنتج بخطوة واحدة (زر "تغيير الصورة الرئيسية" فكارت
 * المنتج فـ/admin/products): الخطوة الثانية بعد نجاح الرفع المباشر من
 * المتصفح إلى Supabase Storage عبر createImageUploadTarget أعلاه. لا ملف
 * يمرّ هنا إطلاقاً — productId وobjectPath فقط، وكلاهما نص قصير جداً.
 *
 * يُحدِّث سجل الصورة الرئيسية الموجود فمكانه (نفس id، يبقى is_primary =
 * true) بدل إنشاء سجل جديد، فلا يمكن أبداً أن ينتج عن هذا سجل "رئيسية"
 * مكرر. إن لم يكن للمنتج أي صورة بعد (حالة نادرة)، يُنشأ سجل واحد جديد
 * كرئيسية.
 *
 * الصورة/الملف القديم لا يُحذف ولا يُلمس أبداً — مقصود.
 */
export async function commitPrimaryImage(
  productId: number,
  objectPath: string
): Promise<ImageActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  if (!validateObjectPathForProduct(objectPath, productId)) {
    return { error: "مسار الصورة غير صالح." };
  }

  if (!isRemoteStorageConfigured()) {
    return { error: storageNotConfiguredMessage() };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { error: "تعذّر الاتصال بمخزن الصور." };
  }

  if (!(await confirmObjectUploaded(client, productId, objectPath))) {
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

/**
 * إضافة صورة إضافية للمنتج (زر "إضافة صورة") — نفس نمط commitPrimaryImage
 * بالضبط: الخطوة الثانية بعد نجاح الرفع المباشر من المتصفح إلى Supabase
 * Storage، لا ملف يمرّ عبر Server Action إطلاقاً. تُنشئ سجلاً جديداً (رئيسية
 * فقط إن لم يكن للمنتج أي صورة بعد)، وتحترم الحد الأقصى MAX_IMAGES_PER_PRODUCT.
 */
export async function commitAdditionalImage(
  productId: number,
  objectPath: string,
  altText: string | null
): Promise<ImageActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  if (!validateObjectPathForProduct(objectPath, productId)) {
    return { error: "مسار الصورة غير صالح." };
  }

  const altTextParsed = productImageAltTextSchema.safeParse(altText || undefined);
  if (!altTextParsed.success) {
    return { error: altTextParsed.error.issues[0]?.message ?? "النص البديل غير صالح." };
  }

  if (!isRemoteStorageConfigured()) {
    return { error: storageNotConfiguredMessage() };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { error: "تعذّر الاتصال بمخزن الصور." };
  }

  const existing = await getProductImagesAdmin(productId);
  if (existing.length >= MAX_IMAGES_PER_PRODUCT) {
    return { error: `الحد الأقصى ${MAX_IMAGES_PER_PRODUCT} صور لكل منتج.` };
  }

  if (!(await confirmObjectUploaded(client, productId, objectPath))) {
    return { error: "تعذّر التأكد من رفع الصورة. حاول مرة أخرى." };
  }

  const { data: publicUrlData } = client.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(objectPath);
  const newStoragePath = publicUrlData.publicUrl;

  const nextSortOrder = existing.reduce((max, img) => Math.max(max, img.sort_order), 0) + 1;
  const isPrimary = existing.length === 0;

  try {
    await sql`
      insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
      values (${productId}, ${newStoragePath}, ${altTextParsed.data || null}, ${nextSortOrder}, ${isPrimary})
    `;
  } catch {
    return { error: "تعذّر حفظ الصورة فقاعدة البيانات. لم يتغيّر شيء." };
  }

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
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
