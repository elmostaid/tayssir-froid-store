import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

// getAdminUser() تحتاج جلسة Supabase Auth حقيقية، وgetSupabaseServiceRoleClient()
// تحتاج SUPABASE_SERVICE_ROLE_KEY حقيقياً — لا شيء منهما متاح فبيئة
// الاختبار. نُحاكي الاثنين هنا (نفس نمط باقي ملفات الاختبار)، مع محاكاة
// الأثر الجانبي الحقيقي لـSupabase Auth (إنشاء صف فـauth.users) يدوياً عبر
// إدخال مباشر، حتى يبقى قيد admin_profiles.id references auth.users(id)
// صحيحاً أثناء الاختبار.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

const createUserMock = vi.fn();
const deleteUserMock = vi.fn();
const getSupabaseServiceRoleClientMock = vi.fn();
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: getSupabaseServiceRoleClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  // تمرير مباشر: لا تخزين مؤقّت في الاختبارات، فينفَّذ الاستعلام الحقيقي.
  unstable_cache: (fn: unknown) => fn,
}));

const { createStaffAccount } = await import("@/app/admin/(protected)/users/actions");

const ADMIN_USER = { id: "test-admin-users", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff-users", email: "staff@local", role: "staff" as const };

function fakeServiceClient() {
  return {
    auth: {
      admin: {
        createUser: createUserMock,
        deleteUser: deleteUserMock,
        getUserById: vi.fn(),
      },
    },
  };
}

function staffForm(email: string, password = "correct-horse-1"): FormData {
  const fd = new FormData();
  fd.set("fullName", "خدامة اختبار");
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

afterEach(async () => {
  vi.clearAllMocks();
  await sql`delete from public.admin_profiles where full_name = 'خدامة اختبار'`;
  await sql`delete from auth.users where email like 'staff-test-%@example.com'`;
});

afterAll(async () => {
  await sql`delete from public.admin_profiles where full_name = 'خدامة اختبار'`;
  await sql`delete from auth.users where email like 'staff-test-%@example.com'`;
});

describe("createStaffAccount — الصلاحيات أولاً", () => {
  test("Staff: يُرفَض قبل أي محاولة اتصال بـSupabase", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const result = await createStaffAccount({ error: null }, staffForm("staff-test-1@example.com"));

    expect(result.error).toBeTruthy();
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe("createStaffAccount — نجاح كامل (Supabase Auth + admin_profiles)", () => {
  test("ينشئ حساباً بدور staff ويربطه بـadmin_profiles، بلا أي أثر لكلمة السر فالنتيجة", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    getSupabaseServiceRoleClientMock.mockReturnValue(fakeServiceClient());

    const fakeUserId = randomUUID();
    const email = "staff-test-2@example.com";
    const password = "correct-horse-2";

    // محاكاة الأثر الجانبي الحقيقي لـauth.admin.createUser: إنشاء صف
    // auth.users فعلي (Supabase تفعل هذا داخلياً، نحاكيه هنا يدوياً).
    createUserMock.mockImplementation(async () => {
      await sql`insert into auth.users (id, email) values (${fakeUserId}, ${email})`;
      return { data: { user: { id: fakeUserId, email } }, error: null };
    });

    const result = await createStaffAccount({ error: null }, staffForm(email, password));

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(JSON.stringify(result)).not.toContain(password);

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ email, password, email_confirm: true })
    );
    expect(deleteUserMock).not.toHaveBeenCalled();

    const [profile] = await sql<{ role: string; full_name: string | null }[]>`
      select role, full_name from public.admin_profiles where id = ${fakeUserId}
    `;
    expect(profile.role).toBe("staff");
    expect(profile.full_name).toBe("خدامة اختبار");
  });

  test("يرفض بريداً غير صالح قبل استدعاء Supabase (validation)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    getSupabaseServiceRoleClientMock.mockReturnValue(fakeServiceClient());

    const result = await createStaffAccount({ error: null }, staffForm("ليس-بريداً"));
    expect(result.error).toBeTruthy();
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test("يرفض كلمة سر أقصر من 8 أحرف قبل استدعاء Supabase (validation)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    getSupabaseServiceRoleClientMock.mockReturnValue(fakeServiceClient());

    const result = await createStaffAccount(
      { error: null },
      staffForm("staff-test-3@example.com", "short")
    );
    expect(result.error).toBeTruthy();
    expect(result.fieldErrors?.password).toBeTruthy();
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe("createStaffAccount — SUPABASE_SERVICE_ROLE_KEY غير مضبوط", () => {
  test("يرفض بوضوح بدل الانهيار", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    getSupabaseServiceRoleClientMock.mockReturnValue(null);

    const result = await createStaffAccount({ error: null }, staffForm("staff-test-4@example.com"));
    expect(result.error).toBeTruthy();
  });
});

describe("createStaffAccount — تراجع (rollback) عند فشل ربط admin_profiles", () => {
  test("يحذف حساب Auth اليتيم إذا فشل الإدراج فـadmin_profiles", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    getSupabaseServiceRoleClientMock.mockReturnValue(fakeServiceClient());

    // معرّف مستخدم لا يوجد له صف فعلي بـauth.users (بعكس السيناريو الناجح
    // أعلاه) — يحاكي فشل ربط قاعدة البيانات (FK violation) بعد نجاح إنشاء
    // حساب Auth، والذي يجب أن يُحفِّز حذف ذلك الحساب اليتيم فوراً.
    const orphanUserId = randomUUID();
    const email = "staff-test-5@example.com";
    createUserMock.mockResolvedValue({ data: { user: { id: orphanUserId, email } }, error: null });
    deleteUserMock.mockResolvedValue({ data: {}, error: null });

    const result = await createStaffAccount({ error: null }, staffForm(email));

    expect(result.error).toBeTruthy();
    expect(deleteUserMock).toHaveBeenCalledWith(orphanUserId);

    const rows = await sql`select id from public.admin_profiles where id = ${orphanUserId}`;
    expect(rows).toHaveLength(0);
  });
});
