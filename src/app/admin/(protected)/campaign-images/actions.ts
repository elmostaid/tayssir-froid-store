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
  CAMPAIGN_IMAGES_SETTINGS_KEY,
  CAMPAIGN_OBJECT_PATH_RE,
  campaignSlotFolder,
  findCampaignSlot,
  isCampaignImageUrl,
  type CampaignImageSlot,
} from "@/lib/campaignImages";

/**
 * صور بطاقات صفحات الحملات — نفس طريق صور المنتجات (رابط رفع موقَّع، ثم
 * تأكيد)، لكن في مجلد `campaign/` منفصل وفي صفّ إعدادات واحد. لا يلمس
 * `product_images` ولا أي منتج.
 *
 * الملف القديم لا يُحذف عند الاستبدال — نفس قاعدة صور المنتجات: صفحةٌ
 * مُخزَّنة مؤقتاً قد تشير إليه لدقيقة، وحذفه يكسر صورتها.
 */

const BUCKET = "product-images";

export type CampaignImageActionState = { error: string | null; success?: boolean };
export type CampaignUploadTarget = { error: string | null; token?: string; objectPath?: string };

async function requireOwner(): Promise<string | null> {
  const admin = await getAdminUser();
  if (!admin) return "غير مصرَّح بهذا الإجراء.";
  if (!isOwnerAdmin(admin)) return "هذا الإجراء مقصور على صاحب الحساب (Admin).";
  return null;
}

function slotOrError(slotKey: string): CampaignImageSlot | string {
  return findCampaignSlot(slotKey) ?? "خانة الصورة غير معروفة.";
}

/** المسار يجب أن يكون في مجلد هذه الخانة نفسها، بالاتفاقية حرفياً. */
function pathBelongsToSlot(objectPath: string, slot: CampaignImageSlot): boolean {
  return CAMPAIGN_OBJECT_PATH_RE.test(objectPath) && objectPath.startsWith(`${campaignSlotFolder(slot)}/`);
}

function revalidateCampaignPages() {
  revalidateCatalog();
  revalidatePath("/washing-machines");
  revalidatePath("/water-heaters");
  revalidatePath("/admin/campaign-images");
}

export async function createCampaignImageUploadTarget(
  slotKey: string,
  contentType: string
): Promise<CampaignUploadTarget> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = slotOrError(slotKey);
  if (typeof slot === "string") return { error: slot };
  if (!isRemoteStorageConfigured()) return { error: "رفع الصور غير مُفعَّل في هذه البيئة." };

  const ext = ALLOWED_IMAGE_TYPES.includes(contentType as (typeof ALLOWED_IMAGE_TYPES)[number])
    ? EXT_BY_TYPE[contentType]
    : null;
  if (!ext) return { error: "صيغة الصورة غير مدعومة. استعمل JPG أو PNG أو WEBP." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { error: "تعذّر الاتصال بمخزن الصور." };

  const objectPath = `${campaignSlotFolder(slot)}/${randomUUID()}.${ext}`;
  const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(objectPath);
  if (error || !data) return { error: "تعذّر تحضير رفع الصورة. حاول مرة أخرى." };
  return { error: null, token: data.token, objectPath: data.path };
}

export async function commitCampaignImage(
  slotKey: string,
  objectPath: string
): Promise<CampaignImageActionState> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = slotOrError(slotKey);
  if (typeof slot === "string") return { error: slot };
  if (!pathBelongsToSlot(objectPath, slot)) return { error: "مسار الصورة غير صالح." };
  if (!isRemoteStorageConfigured()) return { error: "رفع الصور غير مُفعَّل في هذه البيئة." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { error: "تعذّر الاتصال بمخزن الصور." };

  // الملف موجود فعلاً قبل أن تشير إليه الصفحة.
  const folder = campaignSlotFolder(slot);
  const filename = objectPath.slice(folder.length + 1);
  const { data: listing, error: listError } = await client.storage.from(BUCKET).list(folder, { search: filename });
  if (listError || !listing?.some((entry) => entry.name === filename)) {
    return { error: "لم نجد الصورة المرفوعة. أعد المحاولة." };
  }

  const url = client.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
  if (!isCampaignImageUrl(url)) return { error: "رابط الصورة غير صالح." };

  const entry = { [slot.key]: { path: url, updatedAt: new Date().toISOString() } };
  await sql`
    insert into public.settings (key, value)
    values (${CAMPAIGN_IMAGES_SETTINGS_KEY}, ${sql.json(entry)})
    on conflict (key) do update set value = public.settings.value || excluded.value
  `;

  revalidateCampaignPages();
  return { error: null, success: true };
}

/** الرجوع للصورة التلقائية (من منتجات النوع). */
export async function resetCampaignImage(slotKey: string): Promise<CampaignImageActionState> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = slotOrError(slotKey);
  if (typeof slot === "string") return { error: slot };

  await sql`
    update public.settings set value = value - ${slot.key}::text
    where key = ${CAMPAIGN_IMAGES_SETTINGS_KEY}
  `;

  revalidateCampaignPages();
  return { error: null, success: true };
}
