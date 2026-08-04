import { getSettings } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { CheckoutClient } from "@/components/CheckoutClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "إتمام الطلب",
};

export default async function CheckoutPage() {
  // القراءة هنا تمر عبر safeQuery (تتراجع للقيم الافتراضية بصمت عند أي فشل
  // اتصال) لأنها للعرض فقط — الحد الأدنى ومصاريف التوصيل المعروضة للزبون.
  // إرسال الطلب نفسه (CheckoutClient) لا يتصل بقاعدة البيانات إطلاقاً حالياً
  // (يمر عبر واتساب مباشرة)، فحتى لو فشل هذا الاستعلام بالكامل، الصفحة
  // تبقى تعمل بالقيم الافتراضية.
  const settings = await safeQuery(
    () => getSettings(),
    {
      minOrderAmountMad: 1000,
      deliveryFeePerCartonMad: 45,
      whatsappNumber: "+212722083458",
      storeCity: "",
    },
    "checkout.getSettings"
  );

  return (
    <CheckoutClient
      minOrderAmountMad={settings.minOrderAmountMad}
      deliveryFeePerCartonMad={settings.deliveryFeePerCartonMad}
    />
  );
}
