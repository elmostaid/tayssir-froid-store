import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { CheckoutClient } from "@/components/CheckoutClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "إتمام الطلب",
};

export default async function CheckoutPage() {
  // القراءة هنا تمر عبر safeQuery (تتراجع للقيم الافتراضية بصمت عند أي فشل
  // اتصال) لأنها للعرض فقط. إرسال الطلب نفسه (واتساب، فداخل CheckoutClient)
  // لا يتصل بقاعدة البيانات إطلاقاً، فحتى لو فشل هذا الاستعلام بالكامل،
  // الصفحة تبقى تعمل بالقيم الافتراضية — بما فيها codEnabled=true افتراضياً
  // (لا نمنع الزبون من الطلب لمجرد تعذّر قراءة الإعدادات مؤقتاً).
  const settings = await safeQuery(() => getSettings(), FALLBACK_SETTINGS, "checkout.getSettings");

  return (
    <CheckoutClient
      deliveryFeePerCartonMad={settings.deliveryFeePerCartonMad}
      whatsappNumber={settings.whatsappNumber}
      storeName={settings.storeName}
      codEnabled={settings.codEnabled}
    />
  );
}
