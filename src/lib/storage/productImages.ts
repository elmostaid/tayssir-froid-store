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
 * true فقط عندما يكون رفع/حذف صور فعلي ممكناً فعلاً فهذه البيئة: إما تخزين
 * Supabase Storage الحقيقي مُهيَّأ، أو نظام ملفات محلي قابل للكتابة (تطوير
 * محلي، وليس Vercel). تستعملها الواجهة (صفحة /admin/products) لتعطيل أزرار
 * الرفع وعرض رسالة واضحة عند عدم التهيئة، بدل محاولة رفع ستفشل حتماً.
 */
export function canWriteProductImages(): boolean {
  return isRemoteStorageConfigured() || !isRunningOnVercel();
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("STORAGE_NOT_CONFIGURED");
    this.name = "StorageNotConfiguredError";
  }
}

/**
 * يحفظ ملف صورة المنتج ويرجع storage_path لتخزينه في قاعدة البيانات.
 * عند تخزين Supabase Storage الحقيقي المُهيَّأ: القيمة المُرجَعة هي الرابط
 * العام الكامل (https://.../storage/v1/object/public/product-images/...)
 * جاهزاً، لأن resolveProductImageUrl لا يحاول حل/تخمين أي شيء بنفسه —
 * يُعيد أي storage_path يبدأ بـhttps://‏/http:// كما هو حرفياً. محلياً (بلا
 * تخزين سحابي مُهيَّأ): تبقى الاتفاقية القديمة كما كانت دائماً —
 * product-images/{productId}/{filename} نسبةً إلى public/، بلا أي تغيير.
 * اسم الملف نفسه دائماً UUID عشوائي آمن (لا حروف عربية ولا مسافات).
 */
export async function saveProductImageFile(productId: number, file: File): Promise<string> {
  const ext = EXT_BY_TYPE[file.type] ?? "bin";
  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (isRemoteStorageConfigured()) {
    const client = getSupabaseServiceRoleClient();
    if (!client) {
      throw new Error("تعذّر الاتصال بمخزن الصور.");
    }
    const objectKey = `${productId}/${filename}`;
    const { error } = await client.storage
      .from("product-images")
      .upload(objectKey, buffer, { contentType: file.type });
    if (error) {
      throw new Error("تعذّر رفع الصورة إلى مخزن الصور.");
    }
    // نُخزِّن الرابط العام الكامل (https://...) مباشرة كـstorage_path بدل
    // مسار نسبي داخل الـbucket — resolveProductImageUrl يُعيده كما هو حرفياً
    // بلا أي محاولة حل أو تخمين لاحقة (انظر تعليقها).
    const { data } = client.storage.from("product-images").getPublicUrl(objectKey);
    return data.publicUrl;
  }

  const storagePath = `product-images/${productId}/${filename}`;

  if (isRunningOnVercel()) {
    // ممنوع استعمال نظام الملفات المحلي كحل للصور على Vercel — فشل واضح
    // فوراً بدل محاولة كتابة ستفشل حتماً (وقد تُخلّف حالة غير متوقَّعة).
    throw new StorageNotConfiguredError();
  }

  const dir = path.join(LOCAL_IMAGES_ROOT, String(productId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  return storagePath;
}

const PUBLIC_URL_OBJECT_KEY_MARKER = "/storage/v1/object/public/product-images/";

// storagePath هنا إما رابط عام كامل (getPublicUrl الجاهز من saveProductImageFile
// الحديثة) أو مساراً نسبياً قديماً بادئته "product-images/" — نستخرج مفتاح
// الكائن الحقيقي داخل الـbucket من كلتا الصيغتين لحذفٍ صحيح فالحالتين.
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
