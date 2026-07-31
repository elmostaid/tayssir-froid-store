import { sql, isDatabaseConfigured } from "@/lib/db";
import { staticCatalog } from "@/lib/data/staticCatalogFallback";

export type StoreSettings = {
  minOrderAmountMad: number;
  deliveryFeePerCartonMad: number;
  whatsappNumber: string;
  storeCity: string;
};

// قيم احتياطية فقط في حال غاب مفتاح ما استثنائياً من جدول settings؛
// المصدر الحقيقي دائماً هو قاعدة البيانات وليس هذه الثوابت.
const FALLBACK_SETTINGS: StoreSettings = {
  minOrderAmountMad: 1000,
  deliveryFeePerCartonMad: 45,
  whatsappNumber: "+212722083458",
  storeCity: "مراكش - حي المحاميد",
};

export async function getSettings(): Promise<StoreSettings> {
  if (!isDatabaseConfigured) return staticCatalog.settings;

  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from public.settings
  `;
  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    minOrderAmountMad: Number(
      map.get("min_order_amount_mad") ?? FALLBACK_SETTINGS.minOrderAmountMad
    ),
    deliveryFeePerCartonMad: Number(
      map.get("delivery_fee_per_carton_mad") ??
        FALLBACK_SETTINGS.deliveryFeePerCartonMad
    ),
    whatsappNumber: String(
      map.get("whatsapp_number") ?? FALLBACK_SETTINGS.whatsappNumber
    ),
    storeCity: String(map.get("store_city") ?? FALLBACK_SETTINGS.storeCity),
  };
}
