"use server";

import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { createStaffSchema, updateAccountRoleSchema } from "@/lib/validation/adminUser";
import { flattenZodErrors } from "@/lib/validation/zodErrors";

export type UserActionState = {
  error: string | null;
  success?: boolean;
  warning?: string;
  fieldErrors?: Record<string, string>;
};

const OWNER_ONLY_ERROR = "هذا الإجراء مقصور على صاحب الحساب (Admin)." as const;
const LAST_ADMIN_ERROR =
  "لا يمكن تنفيذ هذا الإجراء — سيترك المتجر بدون أي حساب Admin نشط. أنشئ حساب Admin آخر أولاً." as const;
const SERVICE_ROLE_MISSING_ERROR =
  "ميزة إدارة المستخدمين تحتاج SUPABASE_SERVICE_ROLE_KEY مضبوطاً فبيئة الخادم. راجع الإعداد مع فريق البنية التحتية." as const;

// إنشاء حساب Staff جديد: Supabase Auth Admin API (service role) أولاً، ثم
// ربطه بـadmin_profiles. إن فشل الربط بعد نجاح إنشاء حساب Auth (نادر: خطأ
// اتصال بقاعدة البيانات مثلاً)، نحذف حساب Auth اليتيم فوراً (تعويض يدوي —
// النظامان منفصلان، لا معاملة واحدة تجمعهما) بدل ترك حساب دخول بلا صلاحية
// معروفة. لا نُرجع كلمة السر أو أي أثر لها فـالنتيجة أبداً.
export async function createStaffAccount(
  _prevState: UserActionState,
  formData: FormData
): Promise<UserActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  const parsed = createStaffSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "تحقق من البيانات المدخلة.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  const serviceClient = getSupabaseServiceRoleClient();
  if (!serviceClient) {
    return { error: SERVICE_ROLE_MISSING_ERROR };
  }

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return {
      error:
        createError?.message === "User already registered" || createError?.code === "email_exists"
          ? "هذا البريد الإلكتروني مستعمل من حساب آخر."
          : "تعذّر إنشاء حساب الدخول. حاول مرة أخرى.",
    };
  }

  try {
    await sql`
      insert into public.admin_profiles (id, full_name, role)
      values (${created.user.id}, ${parsed.data.fullName}, 'staff')
    `;
  } catch (dbError) {
    console.error("createStaffAccount: فشل ربط admin_profiles، حذف حساب Auth اليتيم", dbError);
    await serviceClient.auth.admin.deleteUser(created.user.id).catch((cleanupError) => {
      console.error("createStaffAccount: فشل أيضاً تنظيف حساب Auth اليتيم", cleanupError);
    });
    return { error: "تعذّر حفظ الحساب الجديد حالياً بسبب مشكلة تقنية. حاول مرة أخرى." };
  }

  revalidatePath("/admin/users");
  return { error: null, success: true };
}

// عدد Admin النشطين (غير المعطَّلين) داخل transaction بقفل صفوف (for
// update) — يمنع أي سباق بين تخفيضين/تعطيلين/حذفين متزامنين قد يُفرغا
// المتجر من كل حسابات Admin معاً رغم أن كل عملية على حدة بدت آمنة وقت فحصها.
async function assertWontRemoveLastAdmin(
  trx: TransactionSql,
  targetProfileId: string,
  targetWillStayActiveAdmin: boolean
): Promise<void> {
  if (targetWillStayActiveAdmin) return;

  const activeAdmins = await trx<{ id: string }[]>`
    select id from public.admin_profiles
    where role = 'admin' and disabled_at is null
    for update
  `;
  const remainingWithoutTarget = activeAdmins.filter((a) => a.id !== targetProfileId);
  if (remainingWithoutTarget.length === 0 && activeAdmins.some((a) => a.id === targetProfileId)) {
    throw new Error("LAST_ADMIN");
  }
}

export async function updateAccountRole(
  profileId: string,
  _prevState: UserActionState,
  formData: FormData
): Promise<UserActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  const parsed = updateAccountRoleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) {
    return { error: "دور غير صالح." };
  }

  try {
    await sql.begin(async (trx) => {
      await assertWontRemoveLastAdmin(trx, profileId, parsed.data.role === "admin");
      await trx`update public.admin_profiles set role = ${parsed.data.role} where id = ${profileId}`;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_ADMIN") {
      return { error: LAST_ADMIN_ERROR };
    }
    console.error("updateAccountRole: خطأ غير متوقع", error);
    return { error: "تعذّر تنفيذ الإجراء حالياً بسبب مشكلة تقنية." };
  }

  revalidatePath("/admin/users");
  return { error: null, success: true };
}

// تعطيل الوصول إلى لوحة الإدارة فقط (عكوس عبر enableAccount) — لا يمس
// حساب Supabase Auth ولا يحذف الصف، فقط disabled_at = now() (انظر
// requireAdmin.ts: أي صف بـdisabled_at غير NULL يُعامَل كأنه غير موجود).
export async function disableAccount(profileId: string): Promise<UserActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  try {
    await sql.begin(async (trx) => {
      const [target] = await trx<{ role: string }[]>`
        select role from public.admin_profiles where id = ${profileId} for update
      `;
      if (!target) throw new Error("NOT_FOUND");
      await assertWontRemoveLastAdmin(trx, profileId, target.role !== "admin");
      await trx`update public.admin_profiles set disabled_at = now() where id = ${profileId}`;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_ADMIN") {
      return { error: LAST_ADMIN_ERROR };
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return { error: "الحساب غير موجود." };
    }
    console.error("disableAccount: خطأ غير متوقع", error);
    return { error: "تعذّر تنفيذ الإجراء حالياً بسبب مشكلة تقنية." };
  }

  revalidatePath("/admin/users");
  return { error: null, success: true };
}

export async function enableAccount(profileId: string): Promise<UserActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  await sql`update public.admin_profiles set disabled_at = null where id = ${profileId}`;

  revalidatePath("/admin/users");
  return { error: null, success: true };
}

// حذف كامل ونهائي: الصف من admin_profiles + حساب Supabase Auth نفسه (عبر
// service role). إن لم يكن service role مضبوطاً، نحذف صف admin_profiles
// فقط (يمنع فوراً أي دخول للوحة الإدارة) ونوضّح للمدير أن حساب Auth
// الأساسي يحتاج حذفاً يدوياً لاحقاً من لوحة تحكم Supabase — تدهور آمن
// (graceful) بدل فشل العملية بالكامل.
export async function deleteAccount(profileId: string): Promise<UserActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  try {
    await sql.begin(async (trx) => {
      const [target] = await trx<{ role: string }[]>`
        select role from public.admin_profiles where id = ${profileId} for update
      `;
      if (!target) throw new Error("NOT_FOUND");
      await assertWontRemoveLastAdmin(trx, profileId, false);
      await trx`delete from public.admin_profiles where id = ${profileId}`;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_ADMIN") {
      return { error: LAST_ADMIN_ERROR };
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return { error: "الحساب غير موجود." };
    }
    console.error("deleteAccount: خطأ غير متوقع", error);
    return { error: "تعذّر تنفيذ الإجراء حالياً بسبب مشكلة تقنية." };
  }

  const serviceClient = getSupabaseServiceRoleClient();
  if (serviceClient) {
    await serviceClient.auth.admin.deleteUser(profileId).catch((error) => {
      console.error(
        "deleteAccount: حُذف صف admin_profiles بنجاح لكن تعذّر حذف حساب Auth — يحتاج حذفاً يدوياً",
        profileId,
        error
      );
    });
  }

  revalidatePath("/admin/users");
  return {
    error: null,
    success: true,
    warning: serviceClient
      ? undefined
      : "حُذف الحساب من لوحة الإدارة، لكن SUPABASE_SERVICE_ROLE_KEY غير مضبوط — احذف حساب الدخول يدوياً من لوحة تحكم Supabase Auth.",
  };
}
