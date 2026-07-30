import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 ميجابايت
export const MAX_IMAGES_PER_PRODUCT = 5;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const LOCAL_IMAGES_ROOT = path.join(process.cwd(), "public", "product-images");

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return "صيغة الصورة غير مدعومة. استعمل JPG أو PNG أو WEBP فقط.";
  }
  if (file.size === 0) {
    return "الملف فارغ.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "حجم الصورة كبير جداً (5 ميجابايت كحد أقصى).";
  }
  return null;
}

// يتفعّل تلقائياً فقط إذا أُضيفت مفاتيح Supabase الحقيقية لاحقاً في .env
// (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY وSUPABASE_SERVICE_ROLE_KEY). لا حساب
// مفعّل الآن، فيبقى هذا المسار غير مستعمل والتخزين المحلي هو الفعلي.
function isRemoteStorageConfigured(): boolean {
  return isSupabaseConfigured() && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * يحفظ ملف صورة المنتج ويرجع storage_path لتخزينه في قاعدة البيانات.
 * الاتفاقية: product-images/{productId}/{filename} — نفس الاتفاقية تُستعمل
 * محلياً (داخل public/) ولاحقاً كمسار كائن داخل bucket باسم "product-images"
 * في Supabase Storage، فتبقى قيم storage_path المخزَّنة صالحة دون أي تغيير
 * عند تفعيل التخزين الحقيقي مستقبلاً.
 */
export async function saveProductImageFile(productId: number, file: File): Promise<string> {
  const ext = EXT_BY_TYPE[file.type] ?? "bin";
  const filename = `${randomUUID()}.${ext}`;
  const storagePath = `product-images/${productId}/${filename}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (isRemoteStorageConfigured()) {
    const client = getSupabaseServiceRoleClient();
    if (!client) {
      throw new Error("تعذّر الاتصال بمخزن الصور.");
    }
    const { error } = await client.storage
      .from("product-images")
      .upload(`${productId}/${filename}`, buffer, { contentType: file.type });
    if (error) {
      throw new Error("تعذّر رفع الصورة إلى مخزن الصور.");
    }
    return storagePath;
  }

  const dir = path.join(LOCAL_IMAGES_ROOT, String(productId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  return storagePath;
}

export async function deleteProductImageFile(storagePath: string): Promise<void> {
  if (isRemoteStorageConfigured()) {
    const client = getSupabaseServiceRoleClient();
    if (client) {
      const objectKey = storagePath.replace(/^product-images\//, "");
      await client.storage.from("product-images").remove([objectKey]);
    }
    return;
  }

  const resolvedRoot = path.resolve(LOCAL_IMAGES_ROOT);
  const resolvedPath = path.resolve(path.join(process.cwd(), "public", storagePath));
  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    // مسار غير متوقع (خارج مجلد صور المنتجات) — لا نحذف شيئاً خارج نطاقه.
    return;
  }

  try {
    await fs.unlink(resolvedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
