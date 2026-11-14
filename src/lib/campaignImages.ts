/**
 * صور بطاقات الأنواع في صفحات الحملات (/washing-machines و/water-heaters).
 *
 * ## لماذا ليست صور المنتجات
 *
 * البطاقة تقول «هذا نوع المكينة/الشوفو ديالك» — صورةٌ تمثّل نوعاً كاملاً،
 * لا قطعةً بعينها. فهي تُدار مستقلّةً: تغييرها لا يلمس `product_images`
 * ولا ترتيب الكتالوج ولا صورة أي منتج.
 *
 * ## أين تُحفظ
 *
 * - **الملف:** نفس bucket الصور العام (`product-images`) لكن تحت مجلد
 *   `campaign/` منفصل عن مجلدات المنتجات (`{productId}/…`). الاسم UUID
 *   جديد في كل رفع، فالتخزين المؤقت الطويل آمن.
 * - **الاختيار:** صفّ واحد في جدول `settings` (`campaign_card_images`) —
 *   JSON بمفتاح لكل خانة. بلا جدول ولا عمود جديد.
 *
 * غياب صورة يدوية لخانة ⇒ صورة تلقائية من منتجات النوع نفسه (انظر
 * `campaignOverview.tsx`)، فالبطاقة لا تظهر فارغة أبداً.
 */

export const CAMPAIGN_IMAGES_SETTINGS_KEY = "campaign_card_images";

export type CampaignImageSlot = {
  /** `{page}:{type}` — مفتاح الخانة في JSON الإعدادات. */
  key: string;
  page: "washing-machines" | "water-heaters";
  type: string;
  pageLabel: string;
  label: string;
};

/** الخانات المسموحة — قائمة مغلقة: لا يُكتب في الإعدادات مفتاح خارجها. */
export const CAMPAIGN_IMAGE_SLOTS: CampaignImageSlot[] = [
  { key: "washing-machines:standard", page: "washing-machines", type: "standard", pageLabel: "مكينات الصابون", label: "مكينة الصابون العادية" },
  { key: "washing-machines:semi", page: "washing-machines", type: "semi", pageLabel: "مكينات الصابون", label: "مكينة الصابون نصف أوتوماتيك" },
  { key: "washing-machines:automatic", page: "washing-machines", type: "automatic", pageLabel: "مكينات الصابون", label: "مكينة الصابون أوتوماتيك" },
  { key: "water-heaters:gas", page: "water-heaters", type: "gas", pageLabel: "الشوفو", label: "قطع غيار الشوفو بالغاز" },
  { key: "water-heaters:electric", page: "water-heaters", type: "electric", pageLabel: "الشوفو", label: "قطع غيار الشوفو بالكهرباء" },
];

export function campaignSlotKey(page: string, type: string): string {
  return `${page}:${type}`;
}

export function findCampaignSlot(key: string): CampaignImageSlot | null {
  return CAMPAIGN_IMAGE_SLOTS.find((slot) => slot.key === key) ?? null;
}

/** مجلد الخانة داخل الـbucket: `campaign/washing-machines-standard`. */
export function campaignSlotFolder(slot: CampaignImageSlot): string {
  return `campaign/${slot.page}-${slot.type}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** مسار كائن صورة حملة: `campaign/{page}-{type}/{UUID}.jpg|jpeg|png|webp`. */
export const CAMPAIGN_OBJECT_PATH_RE = new RegExp(
  `^campaign/(washing-machines|water-heaters)-[a-z]+/${UUID}\\.(jpg|jpeg|png|webp)$`,
  "i"
);

export type CampaignImageOverrides = Record<string, { path: string; updatedAt?: string }>;

/**
 * قراءة دفاعية لقيمة الإعدادات: أي شكل غير متوقَّع ⇒ لا صورة يدوية (فتعود
 * البطاقة لصورتها التلقائية) بدل أن تسقط الصفحة. ولا يُقبل إلا رابط صورة
 * من bucket صورنا — لا رابط خارجي يُكتب في الصفحة.
 */
export function parseCampaignImageOverrides(raw: unknown): CampaignImageOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: CampaignImageOverrides = {};
  for (const slot of CAMPAIGN_IMAGE_SLOTS) {
    const entry = (raw as Record<string, unknown>)[slot.key];
    if (!entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== "string" || !isCampaignImageUrl(path)) continue;
    const updatedAt = (entry as { updatedAt?: unknown }).updatedAt;
    result[slot.key] = { path, ...(typeof updatedAt === "string" ? { updatedAt } : {}) };
  }
  return result;
}

const BUCKET_MARKER = "/storage/v1/object/public/product-images/";

/** رابط عام لكائن تحت `campaign/` في bucket صورنا، ولا شيء غيره. */
export function isCampaignImageUrl(url: string): boolean {
  if (!/^https:\/\//.test(url)) return false;
  const index = url.indexOf(BUCKET_MARKER);
  if (index === -1) return false;
  return CAMPAIGN_OBJECT_PATH_RE.test(url.slice(index + BUCKET_MARKER.length));
}
