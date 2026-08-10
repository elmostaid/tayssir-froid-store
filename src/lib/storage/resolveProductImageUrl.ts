/**
 * محلِّل روابط صور المنتجات — بسيط ومباشر عمداً، بلا أي فحص لنظام الملفات
 * ولا أي تخمين: storage_path إما رابط كامل جاهز (صورة رُفعت حديثاً إلى
 * Supabase Storage — saveProductImageFile يُرجع public URL الكامل الجاهز
 * وقت الرفع نفسه)، أو مسار محلي قديم داخل public/ يُخدَم كما كان دائماً
 * قبل نظام Supabase بالكامل — بلا لمس أو تحليل أو فك ترميز لأي صورة قديمة.
 */
export async function resolveProductImageUrl(storagePath: string): Promise<string> {
  if (storagePath.startsWith("https://") || storagePath.startsWith("http://")) {
    return storagePath;
  }
  return `/${storagePath}`;
}

/**
 * تحل دفعة storage_path دفعة واحدة، وتُرجع كائناً عادياً (وليس Map — قابل
 * للتمرير مباشرة من مكوّن خادمي إلى مكوّن "use client" ضمن props).
 */
export async function resolveProductImageUrls(
  storagePaths: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(storagePaths));
  const entries = await Promise.all(
    unique.map(async (p) => [p, await resolveProductImageUrl(p)] as const)
  );
  return Object.fromEntries(entries);
}
