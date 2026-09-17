import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { CartPageClient } from "@/components/CartPageClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "السلة",
};

// عادت هذه الصفحة تقرأ الإعدادات بعد أن صار فيها زرّ واتساب: الرقم واسم
// المتجر يأتيان من /admin/settings كما في كل روابط واتساب الأخرى، لا
// مكتوبين في الكود. القراءة عبر safeQuery فهي للعرض فقط — تعذّرها يُخفي
// زرّ واتساب ولا يُسقط السلة.
export default async function CartPage() {
  const settings = await safeQuery(() => getSettings(), FALLBACK_SETTINGS, "cart.getSettings");

  return (
    <CartPageClient
      whatsappNumber={settings.whatsappNumber}
      storeName={settings.storeName}
    />
  );
}
