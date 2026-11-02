"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { ALLOWED_IMAGE_TYPES, EXT_BY_TYPE } from "@/lib/storage/imageValidation";
import { isRemoteStorageConfigured } from "@/lib/storage/remoteStorage";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { revalidateCatalog } from "@/lib/queries/catalogCache";
import {
  FEATURED_IMAGES_SETTINGS_KEY,
  FEATURED_OBJECT_PATH_RE,
  featuredImageFolder,
  isFeaturedImageUrl,
} from "@/lib/featuredDisplayImages";

/**
 * صورة العرض لمنتج في «الأكثر طلباً» — نفس طريق صور الحملات: رابط رفع
 * موقَّع من المتصفح مباشرة إلى التخزين، ثم تأكيد هنا. لا يلمس
 * `product_images` ولا المنتج، ولا يُقبل إلا لمنتج موجود فعلاً في القسم.
 */

const BUCKET = "product-images";

export type FeaturedImageActionState = { error: string | null; success?: boolean };
export type FeaturedUploadTarget = { error: string | null; token?: string; objectPath?: string };

async function requireOwner(): Promise<string | null> {
  const admin = await getAdminUser();
  if (!admin) return "غير مصرَّح بهذا الإجراء.";
  if (!isOwnerAdmin(admin)) return "هذا الإجراء مقصور على صاحب الحساب (Admin).";
  return null;
}

async function isFeatured(productId: number): Promise<boolean> {
  if (!Number.isInteger(productId) || productId <= 0) return false;
  const [row] = await sql<{ ok: boolean }[]>`
    select exists(select 1 from public.home_featured_products where product_id = ${productId}) as ok
  `;
  return Boolean(row?.ok);
}

function afterChange() {
  revalidateCatalog();
  revalidatePath("/admin/featured");
  revalidatePath("/", "layout");
}

export async function createFeaturedImageUploadTarget(
  productId: number,
  contentType: string
): Promise<FeaturedUploadTarget> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  if (!(await isFeatured(productId))) return { error: "هذا المنتج ليس في قسم «الأكثر طلباً»." };
  if (!isRemoteStorageConfigured()) return { error: "رفع الصور غير مُفعَّل في هذه البيئة." };

  const ext = ALLOWED_IMAGE_TYPES.includes(contentType as (typeof ALLOWED_IMAGE_TYPES)[number])
    ? EXT_BY_TYPE[contentType]
    : null;
  if (!ext) return { error: "صيغة الصورة غير مدعومة. استعمل JPG أو PNG أو WEBP." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { error: "تعذّر الاتصال بمخزن الصور." };

  const objectPath = `${featuredImageFolder(productId)}/${randomUUID()}.${ext}`;
  const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(objectPath);
  if (error || !data) return { error: "تعذّر تحضير رفع الصورة. حاول مرة أخرى." };
  return { error: null, token: data.token, objectPath: data.path };
}

export async function commitFeaturedImage(
  productId: number,
  objectPath: string
): Promise<FeaturedImageActionState> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const match = FEATURED_OBJECT_PATH_RE.exec(objectPath);
  if (!match || Number(match[1]) !== productId) return { error: "مسار الصورة غير صالح." };
  if (!(await isFeatured(productId))) return { error: "هذا المنتج ليس في قسم «الأكثر طلباً»." };
  if (!isRemoteStorageConfigured()) return { error: "رفع الصور غير مُفعَّل في هذه البيئة." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { error: "تعذّر الاتصال بمخزن الصور." };

  const folder = featuredImageFolder(productId);
  const filename = objectPath.slice(folder.length + 1);
  const { data: listing, error: listError } = await client.storage.from(BUCKET).list(folder, { search: filename });
  if (listError || !listing?.some((entry) => entry.name === filename)) {
    return { error: "لم نجد الصورة المرفوعة. أعد المحاولة." };
  }

  const url = client.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
  if (!isFeaturedImageUrl(url, productId)) return { error: "رابط الصورة غير صالح." };

  const entry = { [String(productId)]: { path: url, updatedAt: new Date().toISOString() } };
  await sql`
    insert into public.settings (key, value)
    values (${FEATURED_IMAGES_SETTINGS_KEY}, ${sql.json(entry)})
    on conflict (key) do update set value = public.settings.value || excluded.value
  `;

  afterChange();
  return { error: null, success: true };
}

/** الرجوع لصورة المنتج نفسها. */
export async function resetFeaturedImage(productId: number): Promise<FeaturedImageActionState> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  if (!Number.isInteger(productId) || productId <= 0) return { error: "منتج غير صالح." };

  await sql`
    update public.settings set value = value - ${String(productId)}::text
    where key = ${FEATURED_IMAGES_SETTINGS_KEY}
  `;

  afterChange();
  return { error: null, success: true };
}
