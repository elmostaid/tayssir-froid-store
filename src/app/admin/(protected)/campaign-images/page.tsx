import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { canWriteProductImages } from "@/lib/storage/remoteStorage";
import { resolveCampaignCardImages } from "@/lib/campaignCardImages";
import { getCampaignImageOverridesFresh } from "@/lib/queries/settings";
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
    </div>
  );
}
