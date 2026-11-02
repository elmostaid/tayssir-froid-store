import type { CatalogProduct } from "@/lib/types";

/**
 * منتجات أقسام صفحة /washing-machines: القطع الأربع تحت كل نوع.
 *
 * ## ما يقرّره المدير وما يُكمَل تلقائياً
 *
 * - **يدوياً** (لوحة «صور الحملات»): أي منتجات تظهر، بأي ترتيب، وصورة عرض
 *   خاصة لكلٍّ منها إن شاء.
 * - **تلقائياً**، ما بقي من الخانات الأربع: الأكثر طلباً في النوع (وحدات
 *   مباعة)، مع **قطعة واحدة من كل صنف** — فلا ثلاثة موطورات في قسم واحد.
 *   كان القسم يأخذ أول أربعة بترتيب الكتالوج، فيتكرّر الصنف ويغيب الأكثر طلباً.
 *
 * ## «الصنف»
 *
 * الكلمة الأولى من اسم المنتج بعد التطبيع: «موطور صابون 150 واط» و«موطور
 * نشاف 70 واط» ⇒ «موطور». قيس على الكتالوج: الأسماء تبدأ بالصنف (منتري،
 * بولي، جلدة، قفل، كروازي، جوان…)، فالقاعدة بسيطة ومرئية للمدير في اللوحة.
 *
 * الاسم والسعر والرابط والحدّ الأدنى وزرّ السلة: من المنتج نفسه، بلا تغيير.
 */

export const SECTION_SIZE = 4;
export const SECTION_SETTINGS_KEY = "campaign_section_products";

export type SectionSlot = {
  key: string;
  page: "washing-machines";
  type: string;
  categorySlug: string;
  label: string;
};

/** صفحة مكينات الصابون وحدها — صفحة الشوفو لا تتغيّر. */
export const SECTION_SLOTS: SectionSlot[] = [
  { key: "washing-machines:standard", page: "washing-machines", type: "standard", categorySlug: "standard-washing-machine-parts", label: "مكينة الصابون العادية" },
  { key: "washing-machines:semi", page: "washing-machines", type: "semi", categorySlug: "semi-automatic-washing-machine-parts", label: "مكينة الصابون نصف أوتوماتيك" },
  { key: "washing-machines:automatic", page: "washing-machines", type: "automatic", categorySlug: "automatic-washing-machine-parts", label: "مكينة الصابون أوتوماتيك" },
];

export function findSectionSlot(key: string): SectionSlot | null {
  return SECTION_SLOTS.find((slot) => slot.key === key) ?? null;
}

/** الصنف: أول كلمة من الاسم، بلا تشكيل ولا علامات، والحروف اللاتينية صغيرة. */
export function partFamily(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .toLowerCase();
  return cleaned.split(/\s+/)[0] ?? "";
}

export type SectionEntry = { productId: number; image?: string };
export type SectionConfig = Record<string, SectionEntry[]>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `campaign-products/{page}-{type}/{productId}/{UUID}.ext` */
export const SECTION_IMAGE_PATH_RE = new RegExp(
  `^campaign-products/(washing-machines-[a-z]+)/(\\d+)/${UUID}\\.(jpg|jpeg|png|webp)$`,
  "i"
);

export function sectionImageFolder(slot: SectionSlot, productId: number): string {
  return `campaign-products/${slot.page}-${slot.type}/${productId}`;
}

const BUCKET_MARKER = "/storage/v1/object/public/product-images/";

/** رابط https لصورة عرض في مجلد هذه الخانة وهذا المنتج بالضبط. */
export function isSectionImageUrl(url: string, slot: SectionSlot, productId: number): boolean {
  if (!/^https:\/\//.test(url)) return false;
  const index = url.indexOf(BUCKET_MARKER);
  if (index === -1) return false;
  const objectPath = url.slice(index + BUCKET_MARKER.length);
  return SECTION_IMAGE_PATH_RE.test(objectPath) && objectPath.startsWith(`${sectionImageFolder(slot, productId)}/`);
}

/** قراءة دفاعية: مدخلٌ غريب يُتجاهل، والقسم يُكمَل تلقائياً بدل أن يسقط. */
export function parseSectionConfig(raw: unknown): SectionConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: SectionConfig = {};
  for (const slot of SECTION_SLOTS) {
    const list = (raw as Record<string, unknown>)[slot.key];
    if (!Array.isArray(list)) continue;
    const seen = new Set<number>();
    const entries: SectionEntry[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const productId = Number((item as { productId?: unknown }).productId);
      if (!Number.isInteger(productId) || productId <= 0 || seen.has(productId)) continue;
      seen.add(productId);
      const image = (item as { image?: unknown }).image;
      entries.push({
        productId,
        ...(typeof image === "string" && isSectionImageUrl(image, slot, productId) ? { image } : {}),
      });
      if (entries.length === SECTION_SIZE) break;
    }
    if (entries.length) result[slot.key] = entries;
  }
  return result;
}

export type RankedProduct = CatalogProduct & { demand_units?: number };

export type SectionItem = {
  product: CatalogProduct;
  /** صورة العرض الخاصة إن وُجدت (رابط مخزَّن)، وإلا null. */
  displayImage: string | null;
  source: "manual" | "auto";
};

/**
 * المنتجات الأربعة لقسم: اليدوية بترتيبها أولاً (ما دام المنتج ظاهراً في
 * نفس التصنيف)، ثم الأكثر طلباً المتوفّر بصنفٍ لم يظهر بعد.
 *
 * `ranked`: منتجات التصنيف الظاهرة، مرتّبة بالطلب تنازلياً.
 */
export function selectSectionProducts(ranked: RankedProduct[], manual: SectionEntry[] = []): SectionItem[] {
  const byId = new Map(ranked.map((product) => [product.id, product]));
  const items: SectionItem[] = [];
  const usedIds = new Set<number>();
  const usedFamilies = new Set<string>();

  for (const entry of manual) {
    const product = byId.get(entry.productId);
    if (!product || usedIds.has(product.id)) continue;
    items.push({ product, displayImage: entry.image ?? null, source: "manual" });
    usedIds.add(product.id);
    usedFamilies.add(partFamily(product.name_ar));
    if (items.length === SECTION_SIZE) return items;
  }

  for (const product of ranked) {
    if (items.length === SECTION_SIZE) break;
    if (usedIds.has(product.id)) continue;
    // التلقائي لا يقترح قطعة نافدة: يُعرض ما يمكن طلبه الآن.
    if (product.status === "out_of_stock" || product.stock_quantity <= 0) continue;
    const family = partFamily(product.name_ar);
    if (usedFamilies.has(family)) continue;
    items.push({ product, displayImage: null, source: "auto" });
    usedIds.add(product.id);
    usedFamilies.add(family);
  }
  return items;
}
