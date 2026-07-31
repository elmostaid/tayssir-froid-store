import { getSettings } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { CartPageClient } from "@/components/CartPageClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "السلة",
};

export default async function CartPage() {
  const settings = await safeQuery(
    () => getSettings(),
    {
      minOrderAmountMad: 1000,
      deliveryFeePerCartonMad: 45,
      whatsappNumber: "+212722083458",
      storeCity: "",
    },
    "cart.getSettings"
  );

  return <CartPageClient minOrderAmountMad={settings.minOrderAmountMad} />;
}
