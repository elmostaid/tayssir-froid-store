import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { ImportDoorLocksButton } from "@/components/admin/ImportDoorLocksButton";
import { DOOR_LOCK_IMPORT_PRODUCTS } from "@/lib/doorLockImportBatch";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "استيراد أقفال الباب",
};

export default async function ImportDoorLocksPage() {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }
  if (!isOwnerAdmin(admin)) {
    redirect("/admin/orders");
  }

  const totalImages = DOOR_LOCK_IMPORT_PRODUCTS.reduce((n, p) => n + p.images.length, 0);

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">استيراد أقفال باب مكينات الغسيل الأوتوماتيكية</h1>
      <p className="mt-2 text-sm text-neutral-500">
        أداة مؤقتة — تُدرج نفس دفعة {DOOR_LOCK_IMPORT_PRODUCTS.length} منتجاً ({totalImages} صورة) الموجودة
        أصلاً بملف الاستيراد المعتمَد، بضغطة واحدة، بدل SQL Editor. آمنة لإعادة التشغيل: أي SKU أو صورة
        موجودة مسبقاً تُتخطّى بلا أي تكرار أو تعديل.
      </p>
      <div className="mt-4">
        <ImportDoorLocksButton />
      </div>
    </div>
  );
}
