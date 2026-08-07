import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { CartPageClient } from "@/components/CartPageClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "السلة",
};

export default async function CartPage() {
  const settings = await safeQuery(() => getSettings(), FALLBACK_SETTINGS, "cart.getSettings");

  return <CartPageClient minOrderAmountMad={settings.minOrderAmountMad} />;
}
