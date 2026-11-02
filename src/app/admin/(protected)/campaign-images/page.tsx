import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { canWriteProductImages } from "@/lib/storage/remoteStorage";
import { resolveCampaignCardImages } from "@/lib/campaignCardImages";
import { getCampaignImageOverridesFresh, getCampaignSectionsFresh } from "@/lib/queries/settings";
import { getCategoryProductsByDemand } from "@/lib/queries/catalog";
import { SECTION_SIZE, SECTION_SLOTS, partFamily, selectSectionProducts } from "@/lib/campaignSections";
import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";
import { CampaignSectionsManager, type SectionGroup } from "@/components/admin/CampaignSectionsManager";
import { campaignSlotKey } from "@/lib/campaignImages";
import { WASHING_TABS } from "@/app/(storefront)/washing-machines/page";
import { HEATER_TABS } from "@/app/(storefront)/water-heaters/page";
import { CampaignImagesManager, type CampaignImageRow } from "@/components/admin/CampaignImagesManager";

export const dynamic = "force-dynamic";

export const metadata = { title: "صور صفحات الحملات" };

const PAGES = [
  { pageKey: "washing-machines", title: "مكينات الصابون", href: "/washing-machines", tabs: WASHING_TABS },
  { pageKey: "water-heaters", title: "الشوفو", href: "/water-heaters", tabs: HEATER_TABS },
] as const;

export default async function AdminCampaignImagesPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const groups = await Promise.all(
    PAGES.map(async (page) => {
      const images = await resolveCampaignCardImages(
        page.pageKey,
        [...page.tabs],
        undefined,
        getCampaignImageOverridesFresh
      );
      const rows: CampaignImageRow[] = page.tabs.map((tab, index) => ({
        slotKey: campaignSlotKey(page.pageKey, tab.key),
        label: tab.fullLabel ?? tab.label,
        imageSrc: images[index].src,
        isManual: images[index].isManual,
      }));
      return { title: page.title, href: page.href, rows };
    })
  );

  // منتجات أقسام /washing-machines كما يراها الزائر الآن: اختيار المدير
  // (قراءة بلا كاش) ثم الإكمال التلقائي — نفس دالة الصفحة العامة.
  const sectionConfig = await getCampaignSectionsFresh();
  const sectionItems = await Promise.all(
    SECTION_SLOTS.map(async (slot) => {
      const ranked = await getCategoryProductsByDemand(slot.categorySlug);
      return selectSectionProducts(ranked, sectionConfig[slot.key]);
    })
  );
  const sectionPaths = sectionItems.flat().flatMap((item) =>
    [item.product.primary_image_path, item.displayImage].filter((path): path is string => Boolean(path))
  );
  const sectionResolved = await resolveProductImageUrls(sectionPaths);
  const sections: SectionGroup[] = SECTION_SLOTS.map((slot, index) => ({
    slotKey: slot.key,
    label: slot.label,
    manualCount: sectionItems[index].filter((item) => item.source === "manual").length,
    items: sectionItems[index].map((item) => ({
      productId: item.product.id,
      name: item.product.name_ar,
      sku: item.product.sku,
      price: item.product.sale_price,
      family: partFamily(item.product.name_ar),
      source: item.source,
      productImageSrc: item.product.primary_image_path ? sectionResolved[item.product.primary_image_path] ?? null : null,
      displayImageSrc: item.displayImage ? sectionResolved[item.displayImage] ?? null : null,
    })),
  }));

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">صور صفحات الحملات</h1>
      <p className="mt-2 text-sm text-neutral-600">
        الصورة التي تظهر في بطاقة كل نوع، أول ما يراه زائر الإعلان. تغييرها هنا لا يغيّر صور
        المنتجات في الكتالوج.
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        بلا صورة يدوية، تأخذ البطاقة تلقائياً صورة منتج من نفس النوع. الصورة تُقصّ بنسبة 4:3 في
        الوسط — اختر صورة الشيء فيها في المنتصف.
      </p>
      <CampaignImagesManager groups={groups} canUpload={canWriteProductImages()} />

      <h2 className="mt-10 text-lg font-bold text-neutral-800" id="sections">
        منتجات أقسام مكينات الصابون
      </h2>
      <p className="mt-2 text-sm text-neutral-600">
        المنتجات الأربعة التي تظهر تحت كل نوع في صفحة /washing-machines. اختر المنتجات ورتّبها، ويمكنك
        تغيير صورة عرضها في هذه الصفحة وحدها.
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        قطعة واحدة من كل صنف في القسم (موطور واحد، منتري واحد…). الاسم والسعر والرابط وزرّ السلة والحدّ
        الأدنى من المنتج نفسه ولا تتغيّر. ما لم تختره يُكمَل تلقائياً بالأكثر طلباً المتوفّر.
      </p>
      <CampaignSectionsManager sections={sections} size={SECTION_SIZE} canUpload={canWriteProductImages()} />
    </div>
  );
}
