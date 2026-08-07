import { z } from "zod";

export const ADMIN_ROLES = ["admin", "staff"] as const;
export type AdminAccountRole = (typeof ADMIN_ROLES)[number];

export const createStaffSchema = z.object({
  fullName: z.string().trim().min(1, "الاسم إجباري.").max(100, "الاسم طويل جداً (100 حرف كحد أقصى)."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "البريد الإلكتروني إجباري.")
    .max(200, "البريد الإلكتروني طويل جداً.")
    .email("بريد إلكتروني غير صحيح."),
  // 8 أحرف كحد أدنى (نفس الحد الأدنى الافتراضي فـSupabase Auth)، 72 كحد
  // أقصى (حد bcrypt الذي تعتمده Supabase داخلياً — كلمة أطول تُقطَع صامتة).
  password: z
    .string()
    .min(8, "كلمة السر يجب أن تكون 8 أحرف على الأقل.")
    .max(72, "كلمة السر طويلة جداً (72 حرفاً كحد أقصى)."),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateAccountRoleSchema = z.object({
  role: z.enum(ADMIN_ROLES),
});
