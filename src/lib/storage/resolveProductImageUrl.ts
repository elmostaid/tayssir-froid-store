import { promises as fs } from "fs";
import path from "path";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isRemoteStorageConfigured } from "@/lib/storage/productImages";

const PRODUCT_IMAGES_BUCKET = "product-images";
const LOCAL_PUBLIC_ROOT = path.join(process.cwd(), "public");

function stripBucketPrefix(storagePath: string): string {
  return storagePath.replace(/^product-images\//, "");
}

// storage_path للصور القديمة مُخزَّن بصيغة مُرمَّزة كرابط (URL-encoded —
// مثلاً "%D9%8A%D8%AF%20..." لاسم ملف عربي فيه مسافات)، بينما الملف الفعلي
// داخل public/ محفوظ باسمه الخام (UTF-8 غير مُرمَّز) — هكذا يكتبه fs.writeFile
// في saveProductImageFile عند الرفع محلياً. فحص وجود الملف يجب أن يُقارن
// بالاسم الخام لا المُرمَّز، وإلا يفشل fs.access دائماً لأي صورة قديمة فيها
// حرف غير ASCII أو مسافة فيُظَن خطأً أنها غير موجودة محلياً وتُحل عبر
// Supabase Storage لمسار لم يُرفَع إليه فعلاً (صورة مكسورة). القيمة المُرجَعة
// كرابط href (localUrl أدناه) تبقى بصيغتها المُرمَّزة الأصلية كما هي —
// المسار المرمَّز صالح تماماً كرابط، والمتصفح/خادم Next الثابت يفكّه تلقائياً.
function toLocalFsPath(storagePath: string): string {
  try {
    return decodeURIComponent(storagePath);
  } catch {
    return storagePath;
  }
}

/**
 * محلِّل روابط صور المنتجات من جهة الخادم فقط (يستعمل fs — يُمنع استيراده من
 * أي مكوّن "use client"؛ الصفحات/الاستعلامات الخادمية تحله وتُمرّر الرابط
 * الجاهز نصاً للمكوّنات).
 *
 * كل صور المنتجات القديمة (قبل إنشاء bucket فـSupabase Storage) موجودة
 * فعلياً كملفات ثابتة داخل public/ ومُضمَّنة فنشر الموقع — تُخدَم محلياً
 * كما كانت دائماً، بلا أي تغيير. أي storage_path لا يُقابله ملف محلي هو
 * صورة رُفعت لاحقاً فعلياً إلى Supabase Storage الحقيقي، فتُحل عبر public
 * URL الرسمي (client.storage.from("product-images").getPublicUrl(...))
 * — بعد إزالة بادئة "product-images/" من storage_path أولاً، لأن
 * .from("product-images") تُضيف اسم الـbucket بنفسها، فلا يتكرر داخل
 * المسار. لا يرمي أي استثناء أبداً: أي فشل فحص محلي أو اتصال بالتخزين
 * البعيد يُعيد أفضل تخمين متاح (المسار المحلي) بدل إسقاط الصفحة المستدعية.
 */
export async function resolveProductImageUrl(storagePath: string): Promise<string> {
  const localUrl = `/${storagePath}`;

  try {
    await fs.access(path.join(LOCAL_PUBLIC_ROOT, toLocalFsPath(storagePath)));
    return localUrl;
  } catch {
    // لا وجود محلياً — نكمل لمحاولة الرابط البعيد أدناه.
  }

  if (isRemoteStorageConfigured()) {
    try {
      const client = getSupabaseServiceRoleClient();
      if (client) {
        const objectKey = stripBucketPrefix(storagePath);
        const { data } = client.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(objectKey);
        if (data?.publicUrl) return data.publicUrl;
      }
    } catch {
      // تجاهل — نرجع للمسار المحلي أدناه كملاذ أخير.
    }
  }

  return localUrl;
}

/**
 * تحل دفعة storage_path دفعة واحدة، وتُرجع كائناً عادياً (وليس Map — قابل
 * للتمرير مباشرة من مكوّن خادمي إلى مكوّن "use client" ضمن props).
 */
export async function resolveProductImageUrls(
  storagePaths: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(storagePaths));
  try {
    const entries = await Promise.all(
      unique.map(async (p) => [p, await resolveProductImageUrl(p)] as const)
    );
    return Object.fromEntries(entries);
  } catch (err) {
    console.error("resolveProductImageUrls failed — callers fall back to local URL guesses", err);
    return {};
  }
}
