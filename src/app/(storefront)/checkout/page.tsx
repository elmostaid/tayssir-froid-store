import { getSettings } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { CheckoutClient } from "@/components/CheckoutClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "إتمام الطلب",
};

export default async function CheckoutPage() {
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
