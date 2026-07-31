import raw from "./staticCatalog.json";
import type {
  Category,
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductImage,
} from "@/lib/types";

// نسخة ثابتة من نفس بيانات الـviews الآمنة (catalog_*)، مُصدَّرة سلفاً عبر
// scripts/export-static-catalog.mjs. تُستعمل فقط كـfallback عندما
// DATABASE_URL غير معرَّف — لا تحتوي أبداً على ثمن الشراء أو منتجات غير
// منشورة، لأنها نسخة طبق الأصل مما تُرجعه الـviews نفسها.

type StaticCatalog = {
  categories: Category[];
  products: CatalogProduct[];
  variantsByProductId: Record<number, CatalogProductVariant[]>;
  imagesByProductId: Record<number, CatalogProductImage[]>;
  settings: {
    minOrderAmountMad: number;
    deliveryFeePerCartonMad: number;
    whatsappNumber: string;
    storeCity: string;
  };
};

export const staticCatalog = raw as unknown as StaticCatalog;
