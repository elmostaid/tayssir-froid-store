import { z } from "zod";

export const categorySchema = z.object({
  nameAr: z
    .string()
    .trim()
    .min(1, "الاسم العربي إجباري.")
    .max(100, "الاسم العربي طويل جداً (100 حرف كحد أقصى)."),
  nameFr: z
    .string()
    .trim()
    .max(100, "الاسم الفرنسي طويل جداً (100 حرف كحد أقصى).")
    .optional()
    .or(z.literal("")),
  slug: z
    .string()
    .trim()
    .min(1, "الرابط (slug) إجباري.")
    .max(80, "الرابط طويل جداً.")
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "الرابط يجب أن يحتوي أحرفاً إنجليزية صغيرة وأرقاماً وشرطات فقط (مثال: washing-machine-parts)."
    ),
  parentId: z.number().int().positive().nullable(),
  sortOrder: z.number().int().min(0).max(9999),
  isActive: z.boolean(),
});

export type CategoryInput = z.infer<typeof categorySchema>;
