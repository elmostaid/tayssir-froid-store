import { z } from "zod";
import { PRICING_MODES } from "@/lib/pricing/tierPricing";

export const PRODUCT_STATUSES = ["draft", "published", "out_of_stock"] as const;

// حقول التسعير المتدرِّج — تُدمج في productSchema ثم يتحقق superRefine أدناه
// من تماسكها. القيم null مقبولة دائماً هنا لأن نمط "ثمن واحد" لا يستعملها
// إطلاقاً؛ الإلزام يأتي من النمط المختار لا من الحقل نفسه.
const tierPricingFields = {
  pricingMode: z.enum(PRICING_MODES),
  tier2MinQty: z.number().int().min(2, "يجب أن تكون 2 على الأقل.").nullable(),
  tier2Price: z.number().min(0, "يجب أن يكون 0 أو أكثر.").nullable(),
  tier3MinQty: z.number().int().min(2, "يجب أن تكون 2 على الأقل.").nullable(),
  tier3Price: z.number().min(0, "يجب أن يكون 0 أو أكثر.").nullable(),
  showBulkWhatsapp: z.boolean(),
};

type TierPricingShape = {
  pricingMode: (typeof PRICING_MODES)[number];
  tier2MinQty: number | null;
  tier2Price: number | null;
  tier3MinQty: number | null;
  tier3Price: number | null;
};

/**
 * نفس منطق قيد products_pricing_mode_coherent في قاعدة البيانات، لكن برسائل
 * عربية مفهومة على الحقل المعني بالضبط بدل خطأ Postgres خام.
 */
function refineTierPricing(
  value: TierPricingShape,
  ctx: z.RefinementCtx,
  minOrderQty?: number
) {
  if (value.pricingMode === "single") return;

  if (value.tier2MinQty === null) {
    ctx.addIssue({
      code: "custom",
      path: ["tier2MinQty"],
      message: "حدِّد الكمية التي يبدأ منها ثمن الجملة.",
    });
  }
  if (value.tier2Price === null) {
    ctx.addIssue({ code: "custom", path: ["tier2Price"], message: "حدِّد ثمن الجملة." });
  }

  if (
    minOrderQty !== undefined &&
    value.tier2MinQty !== null &&
    value.tier2MinQty <= minOrderQty
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["tier2MinQty"],
      message: `يجب أن تكون أكبر من الكمية الدنيا للطلب (${minOrderQty})، وإلا فلن يُباع المنتج أبداً بثمن القطعة.`,
    });
  }

  if (value.pricingMode === "three_tier") {
    if (value.tier3MinQty === null) {
      ctx.addIssue({
        code: "custom",
        path: ["tier3MinQty"],
        message: "حدِّد الكمية التي يبدأ منها ثمن الجملة الكبيرة.",
      });
    }
    if (value.tier3Price === null) {
      ctx.addIssue({
        code: "custom",
        path: ["tier3Price"],
        message: "حدِّد ثمن الجملة الكبيرة.",
      });
    }
    if (
      value.tier2MinQty !== null &&
      value.tier3MinQty !== null &&
      value.tier3MinQty <= value.tier2MinQty
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["tier3MinQty"],
        message: "يجب أن تكون أكبر من بداية المستوى الثاني.",
      });
    }
  }
}

export const productSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, "SKU إجباري.")
    .max(50, "SKU طويل جداً (50 حرفاً كحد أقصى).")
    .regex(/^[A-Za-z0-9_-]+$/, "SKU يجب أن يحتوي أحرفاً إنجليزية وأرقاماً وشرطات فقط."),
  slug: z
    .string()
    .trim()
    .min(1, "الرابط إجباري.")
    .max(100, "الرابط طويل جداً.")
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "الرابط يجب أن يحتوي أحرفاً إنجليزية صغيرة وأرقاماً وشرطات فقط."
    ),
  categoryId: z.number().int().positive("اختر تصنيفاً."),
  nameAr: z.string().trim().min(1, "الاسم العربي إجباري.").max(150, "الاسم طويل جداً."),
  nameFr: z.string().trim().max(150, "الاسم الفرنسي طويل جداً.").optional().or(z.literal("")),
  descriptionAr: z
    .string()
    .trim()
    .max(1000, "الوصف طويل جداً (1000 حرف كحد أقصى).")
    .optional()
    .or(z.literal("")),
  technicalSpecs: z
    .string()
    .trim()
    .max(1000, "المواصفات التقنية طويلة جداً.")
    .optional()
    .or(z.literal("")),
  unitLabel: z.string().trim().min(1, "وحدة البيع إجبارية.").max(30, "وحدة البيع طويلة جداً."),
  minOrderQty: z.number().int().min(1, "يجب أن تكون 1 على الأقل."),
  qtyIncrement: z.number().int().min(1, "يجب أن تكون 1 على الأقل."),
  purchasePrice: z.number().min(0, "يجب أن يكون 0 أو أكثر.").nullable(),
  salePrice: z.number().min(0, "يجب أن يكون 0 أو أكثر."),
  stockQuantity: z.number().int().min(0, "يجب أن يكون 0 أو أكثر."),
  status: z.enum(PRODUCT_STATUSES),
  ...tierPricingFields,
}).superRefine((value, ctx) => refineTierPricing(value, ctx, value.minOrderQty));

export type ProductInput = z.infer<typeof productSchema>;

// حقول التعديل السريع فقط (من قائمة /admin/products مباشرة، بدون فتح
// المنتج) — نفس قيود الحقول المقابلة فـproductSchema بالضبط، دون الحقول
// الأخرى (sku/slug/name/category/...) غير القابلة للتعديل السريع.
export const productQuickEditSchema = z.object({
  salePrice: z.number().min(0, "يجب أن يكون 0 أو أكثر."),
  purchasePrice: z.number().min(0, "يجب أن يكون 0 أو أكثر.").nullable(),
  stockQuantity: z.number().int().min(0, "يجب أن يكون 0 أو أكثر."),
  minOrderQty: z.number().int().min(1, "يجب أن تكون 1 على الأقل."),
  status: z.enum(PRODUCT_STATUSES),
});

export type ProductQuickEditInput = z.infer<typeof productQuickEditSchema>;

export const variantSchema = z.object({
  variantName: z.string().trim().min(1, "اسم المتغير إجباري.").max(60, "الاسم طويل جداً."),
  salePriceOverride: z.number().min(0, "يجب أن يكون 0 أو أكثر.").nullable(),
  stockQuantity: z.number().int().min(0, "يجب أن يكون 0 أو أكثر."),
  minOrderQtyOverride: z.number().int().min(1, "يجب أن تكون 1 على الأقل.").nullable(),
  qtyIncrementOverride: z.number().int().min(1, "يجب أن تكون 1 على الأقل.").nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
});

export type VariantInput = z.infer<typeof variantSchema>;

export const productImageAltTextSchema = z
  .string()
  .trim()
  .max(200, "النص البديل طويل جداً (200 حرف كحد أقصى).")
  .optional()
  .or(z.literal(""));
