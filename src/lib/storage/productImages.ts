import { promises as fs } from "fs";
import path from "path";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES_PER_PRODUCT, EXT_BY_TYPE, validateImageFile } from "@/lib/storage/imageValidation";

const LOCAL_IMAGES_ROOT = path.join(process.cwd(), "public", "product-images");

// يتفعّل تلقائياً فقط إذا أُضيفت مفاتيح Supabase الحقيقية فـ.env
// (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY وSUPABASE_SERVICE_ROLE_KEY). مُصدَّرة
// لأن الواجهة (صفحة /admin/products) تحتاج معرفة هذه الحالة مسبقاً لتعطيل
// أزرار الرفع وعرض رسالة واضحة بدل محاولة رفع سيفشل حتماً.
export function isRemoteStorageConfigured(): boolean {
  return isSupabaseConfigured() && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Vercel (والبيئات الخادمية المشابهة) توفّر نظام ملفات للقراءة فقط خارج
// /tmp — أي محاولة fs.writeFile/fs.unlink داخل public/ هناك تفشل حتماً
// (EROFS). متغيّر VERCEL مضبوط تلقائياً من المنصة نفسها فكل بيئاتها
// (Production/Preview/Development)، فهو الإشارة الموثوقة لمنع أي كتابة/حذف
// محلي بدل الاعتماد على NODE_ENV وحدها.
function isRunningOnVercel(): boolean {
  return !!process.env.VERCEL;
}

/**
 * true فقط عندما يكون رفع صور فعلي ممكناً فعلاً فهذه البيئة: تخزين Supabase
 * Storage الحقيقي مُهيَّأ. الرفع (تغيير الصورة الرئيسية أو إضافة صورة) دائماً
 * مباشرة من المتصفح إلى Supabase Storage — لا مسار محلي بديل للرفع إطلاقاً،
 * فلا داعي لفحص Vercel هنا. تستعملها الواجهة (صفحة /admin/products) لتعطيل
 * أزرار الرفع وعرض رسالة واضحة عند عدم التهيئة، بدل محاولة رفع ستفشل حتماً.
 */
export function canWriteProductImages(): boolean {
  return isRemoteStorageConfigured();
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("STORAGE_NOT_CONFIGURED");
    this.name = "StorageNotConfiguredError";
  }
}

const PUBLIC_URL_OBJECT_KEY_MARKER = "/storage/v1/object/public/product-images/";

// storagePath هنا إما رابط عام كامل (getPublicUrl الجاهز وقت الرفع المباشر)
// أو مساراً نسبياً قديماً بادئته "product-images/" — نستخرج مفتاح الكائن
// الحقيقي داخل الـbucket من كلتا الصيغتين لحذفٍ صحيح فالحالتين.
function objectKeyFromStoragePath(storagePath: string): string {
  const markerIndex = storagePath.indexOf(PUBLIC_URL_OBJECT_KEY_MARKER);
  if (markerIndex !== -1) {
    return storagePath.slice(markerIndex + PUBLIC_URL_OBJECT_KEY_MARKER.length);
  }
  return storagePath.replace(/^product-images\//, "");
}

export async function deleteProductImageFile(storagePath: string): Promise<void> {
  if (isRemoteStorageConfigured()) {
    const client = getSupabaseServiceRoleClient();
    if (client) {
      await client.storage.from("product-images").remove([objectKeyFromStoragePath(storagePath)]);
    }
    return;
  }

  if (isRunningOnVercel()) {
    throw new StorageNotConfiguredError();
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
