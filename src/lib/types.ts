import type { PricingMode } from "@/lib/pricing/tierPricing";

export type Category = {
  id: number;
  slug: string;
  name_ar: string;
  name_fr: string | null;
  description_ar: string | null;
  parent_id: number | null;
  sort_order: number;
};

export type CatalogProduct = {
  id: number;
  sku: string;
  slug: string;
  category_id: number;
  category_slug: string;
  category_name_ar: string;
  name_ar: string;
  name_fr: string | null;
  description_ar: string | null;
  technical_specs: string | null;
  unit_label: string;
  min_order_qty: number;
  qty_increment: number;
  // القيم numeric ترجع كنص من postgres.js لتفادي فقدان الدقة العشرية
  sale_price: string;
  stock_quantity: number;
  meta_title: string | null;
  meta_description: string | null;
  primary_image_path: string | null;
  /** "published" أو "out_of_stock" فقط (الـview لا تعرض "draft"/"archived" إطلاقاً) */
  status: "published" | "out_of_stock";
  // التسعير المتدرِّج — sale_price أعلاه هو ثمن المستوى الأول دائماً.
  // "single" يعني نفس السلوك القديم بالضبط: sale_price لكل الكميات.
  pricing_mode: PricingMode;
  tier2_min_qty: number | null;
  tier2_price: string | null;
  tier3_min_qty: number | null;
  tier3_price: string | null;
  show_bulk_whatsapp: boolean;
};

export type CatalogProductVariant = {
  id: number;
  product_id: number;
  variant_name: string;
  sale_price: string;
  stock_quantity: number;
  min_order_qty: number;
  qty_increment: number;
  sort_order: number;
  /** هل للمتغيّر ثمن خاص (sale_price_override) بدل وراثة ثمن المنتج الأب؟
   * ثمن خاص يُلغي سلَّم أثمنة المنتج الأب ويُعامَل كثمن واحد — انظر
   * resolveVariantPricing في lib/pricing/tierPricing.ts. */
  has_price_override: boolean;
};

export type CatalogProductImage = {
  id: number;
  product_id: number;
  storage_path: string;
  alt_text_ar: string | null;
  sort_order: number;
  is_primary: boolean;
};
