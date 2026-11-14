import { getProducts, getProductsBySkus } from "@/lib/queries/catalog";
import { getCampaignImageOverrides } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";
import { campaignSlotKey, type CampaignImageOverrides } from "@/lib/campaignImages";
import type { CatalogProduct } from "@/lib/types";
import type { CampaignTab } from "@/app/(storefront)/campaignLanding";

export type CampaignCardImage = {
  /** المسار كما هو مخزَّن، أو null إن لم توجد أي صورة. */
  path: string | null;
  /** الرابط الجاهز للعرض. */
  src: string | null;
  isManual: boolean;
};

/**
 * صورة بطاقة كل نوع، بالأولوية: اليدوية (لوحة الإدارة) ← صورة المنتج
 * الممثِّل (`coverSku`) ← صورة أول منتج في النوع.
 *
 * `firstProducts` اختياري: صفحة الحملة جلبت منتجات كل نوع أصلاً فتمرّرها،
 * ولوحة الإدارة لا، فتُجلب هنا (منتج واحد لكل نوع، من نفس الكاش).
 * أي عطل قراءة ⇒ بطاقة بلا صورة يدوية، لا صفحة ساقطة.
 */
export async function resolveCampaignCardImages(
  pageKey: string,
  tabs: CampaignTab[],
  firstProducts?: (CatalogProduct | null)[],
  /** لوحة الإدارة تمرّر قراءة بلا كاش؛ الصفحة العامة تستعمل الكاش. */
  overridesLoader: () => Promise<CampaignImageOverrides> = getCampaignImageOverrides
): Promise<CampaignCardImage[]> {
  const coverSkus = tabs.map((tab) => tab.coverSku).filter((sku): sku is string => Boolean(sku));
  const [overrides, coverProducts, firsts] = await Promise.all([
    safeQuery(overridesLoader, {} as CampaignImageOverrides, "campaignCardImages.overrides"),
    coverSkus.length
      ? safeQuery(() => getProductsBySkus(coverSkus), [] as CatalogProduct[], "campaignCardImages.covers")
      : Promise.resolve([] as CatalogProduct[]),
    firstProducts
      ? Promise.resolve(firstProducts)
      : Promise.all(
          tabs.map((tab) =>
            safeQuery(
              async () => (await getProducts({ categorySlug: tab.categorySlug, limit: 1 }))[0] ?? null,
              null,
              `campaignCardImages.first(${tab.key})`
            )
          )
        ),
  ]);

  const chosen = tabs.map((tab, index) => {
    const manual = overrides[campaignSlotKey(pageKey, tab.key)]?.path;
    if (manual) return { path: manual, isManual: true };
    const cover = tab.coverSku
      ? coverProducts.find((product) => product.sku === tab.coverSku)?.primary_image_path
      : null;
    return { path: cover ?? firsts[index]?.primary_image_path ?? null, isManual: false };
  });

  const resolved = await resolveProductImageUrls(
    chosen.map((image) => image.path).filter((path): path is string => Boolean(path))
  );
  return chosen.map((image) => ({ ...image, src: image.path ? resolved[image.path] ?? null : null }));
}
