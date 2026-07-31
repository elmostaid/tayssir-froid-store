import { z } from "zod";

export const PRODUCT_STATUSES = ["draft", "published", "out_of_stock"] as const;

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
});

export type ProductInput = z.infer<typeof productSchema>;

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
