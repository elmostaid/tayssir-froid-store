/**
 * «صورة العرض» لمنتجات قسم «الأكثر طلباً» في الصفحة الرئيسية.
 *
 * صورةٌ تظهر على بطاقة المنتج **في هذا القسم وحده**: صورة الكتالوج
 * (`product_images`) وصفحة المنتج والسلة والثمن والرابط لا تتغيّر.
 *
 * - **الملف:** bucket الصور نفسه، مجلد `featured/{productId}/` منفصل عن
 *   مجلدات المنتجات (`{productId}/…`) وعن صور الحملات (`campaign/…`).
 * - **الاختيار:** صفّ واحد في `settings` (`featured_display_images`) —
 *   JSON بمفتاح لكل منتج. بلا جدول ولا عمود جديد.
 *
 * نفس نمط `campaignImages.ts`، مفصول عنه عمداً: خانات الحملات قائمة مغلقة
 * مكتوبة في الكود، وهنا المفتاح رقم منتج يتغيّر مع اختيار المدير.
 */

export const FEATURED_IMAGES_SETTINGS_KEY = "featured_display_images";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `featured/{productId}/{UUID}.ext` */
export const FEATURED_OBJECT_PATH_RE = new RegExp(`^featured/(\\d+)/${UUID}\\.(jpg|jpeg|png|webp)$`, "i");

export function featuredImageFolder(productId: number): string {
  return `featured/${productId}`;
}

const BUCKET_MARKER = "/storage/v1/object/public/product-images/";

/** رابط https لكائن تحت `featured/{productId}/` في bucket صورنا، ولا غيره. */
export function isFeaturedImageUrl(url: string, productId?: number): boolean {
  if (!/^https:\/\//.test(url)) return false;
  const index = url.indexOf(BUCKET_MARKER);
  if (index === -1) return false;
  const match = FEATURED_OBJECT_PATH_RE.exec(url.slice(index + BUCKET_MARKER.length));
  if (!match) return false;
  return productId === undefined || Number(match[1]) === productId;
}

export type FeaturedDisplayImages = Record<string, { path: string; updatedAt?: string }>;

/**
 * قراءة دفاعية: أي مدخل غريب يُتجاهل (فتعود البطاقة لصورة المنتج) بدل أن
 * تسقط الصفحة الرئيسية. المفتاح رقم منتج، والرابط يجب أن يكون في مجلد
 * نفس المنتج — لا يمكن لمدخلٍ أن يعرض صورة منتج آخر.
 */
export function parseFeaturedDisplayImages(raw: unknown): FeaturedDisplayImages {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: FeaturedDisplayImages = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== "string" || !isFeaturedImageUrl(path, Number(key))) continue;
    const updatedAt = (entry as { updatedAt?: unknown }).updatedAt;
    result[key] = { path, ...(typeof updatedAt === "string" ? { updatedAt } : {}) };
  }
  return result;
}
