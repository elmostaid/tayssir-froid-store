/**
 * يحوّل storage_path المخزَّن في قاعدة البيانات إلى رابط صورة قابل للعرض.
 * بعد ربط مخزن الصور الحقيقي (Supabase Storage) نضبط NEXT_PUBLIC_SUPABASE_STORAGE_URL
 * في .env.local. قبل ذلك، الصور التجريبية تُقرأ من public/ محلياً.
 */
export function resolveImageUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_URL;
  if (base) {
    return `${base.replace(/\/$/, "")}/${storagePath}`;
  }
  return `/${storagePath}`;
}
