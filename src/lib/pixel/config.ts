/**
 * معرّف Meta Pixel — يُقرأ فقط من NEXT_PUBLIC_META_PIXEL_ID. بدون ضبطه، لا
 * يُحمَّل أي سكريبت Pixel إطلاقاً (لا معرّف مخترَع أو تجريبي). نفس أسلوب
 * getSiteUrl() (siteUrl.ts): دالة صغيرة، بلا حالة، ترجع null إن لم يُضبط.
 */
export function getMetaPixelId(): string | null {
  const raw = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  if (!raw) return null;
  return raw;
}
