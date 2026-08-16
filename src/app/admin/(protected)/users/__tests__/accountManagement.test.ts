import { afterEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

// SUPABASE_SERVICE_ROLE_KEY غير مضبوط فبيئة الاختبار (كما فـProduction بلا
// إعداد حقيقي) — deleteAccount يجب أن يتدهور بأمان (يحذف صف admin_profiles
// فقط) بدل الانهيار، وهذا هو بالضبط ما نختبره هنا بعدم محاكاة الوحدة إطلاقاً.
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: () => null,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  // تمرير مباشر: لا تخزين مؤقّت في الاختبارات، فينفَّذ الاستعلام الحقيقي.
  unstable_cache: (fn: unknown) => fn,
}));

const { updateAccountRole, disableAccount, enableAccount, deleteAccount } = await import(
  "@/app/admin/(protected)/users/actions"
);

const ADMIN_USER = { id: "test-admin-mgmt", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff-mgmt", email: "staff@local", role: "staff" as const };

type Fixture = { id: string; role: "admin" | "staff" };
let fixtures: Fixture[] = [];

async function createFixtureAccount(role: "admin" | "staff", disabled = false): Promise<string> {
  const id = randomUUID();
  const email = `fixture-${id}@example.com`;
  await sql`insert into auth.users (id, email) values (${id}, ${email})`;
  await sql`
    insert into public.admin_profiles (id, full_name, role, disabled_at)
    values (${id}, 'حساب اختبار', ${role}, ${disabled ? sql`now()` : null})
  `;
  fixtures.push({ id, role });
  return id;
}

afterEach(async () => {
  vi.clearAllMocks();
  for (const f of fixtures) {
    await sql`delete from public.admin_profiles where id = ${f.id}`;
    await sql`delete from auth.users where id = ${f.id}`;
  }
  fixtures = [];
});

describe("updateAccountRole / disableAccount / enableAccount / deleteAccount — Staff ممنوع تماماً", () => {
  test("Staff يُرفَض من الأربعة، ولا يتغيّر أي شيء", async () => {
    const targetId = await createFixtureAccount("staff");

    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const roleForm = new FormData();
    roleForm.set("role", "admin");
    const r1 = await updateAccountRole(targetId, { error: null }, roleForm);
    expect(r1.error).toBeTruthy();

    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const r2 = await disableAccount(targetId);
    expect(r2.error).toBeTruthy();

    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const r3 = await enableAccount(targetId);
    expect(r3.error).toBeTruthy();

    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const r4 = await deleteAccount(targetId);
    expect(r4.error).toBeTruthy();

    const [row] = await sql<{ role: string; disabled_at: string | null }[]>`
      select role, disabled_at from public.admin_profiles where id = ${targetId}
    `;
    expect(row.role).toBe("staff");
    expect(row.disabled_at).toBeNull();
  });
});

describe("updateAccountRole — Admin يقدر يغيّر الدور فالاتجاهين", () => {
  test("staff → admin", async () => {
    const targetId = await createFixtureAccount("staff");
    await createFixtureAccount("admin"); // يضمن وجود admin نشط آخر (غير مطلوب هنا لكن واقعي)

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const fd = new FormData();
    fd.set("role", "admin");
    const result = await updateAccountRole(targetId, { error: null }, fd);

    expect(result.success).toBe(true);
    const [row] = await sql<{ role: string }[]>`select role from public.admin_profiles where id = ${targetId}`;
    expect(row.role).toBe("admin");
  });

  test("admin → staff (مع وجود admin آخر نشط)", async () => {
    const targetId = await createFixtureAccount("admin");
    await createFixtureAccount("admin"); // admin آخر نشط، فالتخفيض آمن

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const fd = new FormData();
    fd.set("role", "staff");
    const result = await updateAccountRole(targetId, { error: null }, fd);

    expect(result.success).toBe(true);
    const [row] = await sql<{ role: string }[]>`select role from public.admin_profiles where id = ${targetId}`;
    expect(row.role).toBe("staff");
  });
});

describe("حماية آخر Admin — يمنع تصفير عدد حسابات Admin النشطة", () => {
  test("يرفض تخفيض آخر Admin نشط إلى staff", async () => {
    // نحذف مؤقتاً أي admin نشط آخر قد يكون موجوداً محلياً (لا يوجد فعلياً
    // فقاعدة الاختبار المحلية، لكن الفحص أدناه يعتمد فقط على fixture واحد
    // نتحكم فيه بالكامل — نتحقق أولاً أنه الوحيد).
    const before = await sql<{ count: number }[]>`
      select count(*)::int as count from public.admin_profiles where role = 'admin' and disabled_at is null
    `;
    expect(before[0].count).toBe(0); // بيئة الاختبار المحلية بلا أي admin_profiles مسبقاً

    const onlyAdminId = await createFixtureAccount("admin");

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const fd = new FormData();
    fd.set("role", "staff");
    const result = await updateAccountRole(onlyAdminId, { error: null }, fd);

    expect(result.error).toBeTruthy();
    const [row] = await sql<{ role: string }[]>`select role from public.admin_profiles where id = ${onlyAdminId}`;
    expect(row.role).toBe("admin"); // لم يتغيّر
  });

  test("يرفض تعطيل آخر Admin نشط", async () => {
    const onlyAdminId = await createFixtureAccount("admin");

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await disableAccount(onlyAdminId);

    expect(result.error).toBeTruthy();
    const [row] = await sql<{ disabled_at: string | null }[]>`
      select disabled_at from public.admin_profiles where id = ${onlyAdminId}
    `;
    expect(row.disabled_at).toBeNull(); // لم يتعطَّل
  });

  test("يرفض حذف آخر Admin نشط", async () => {
    const onlyAdminId = await createFixtureAccount("admin");

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await deleteAccount(onlyAdminId);

    expect(result.error).toBeTruthy();
    const rows = await sql`select id from public.admin_profiles where id = ${onlyAdminId}`;
    expect(rows).toHaveLength(1); // لم يُحذَف
  });

  test("يسمح بتعطيل/حذف Admin عندما يوجد admin نشط آخر", async () => {
    const targetId = await createFixtureAccount("admin");
    await createFixtureAccount("admin");

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const disableResult = await disableAccount(targetId);
    expect(disableResult.success).toBe(true);
  });

  test("Admin معطَّل مسبقاً لا يُحتسَب — تعطيل آخر admin نشط متبقٍّ يُرفَض", async () => {
    const disabledAdminId = await createFixtureAccount("admin", true); // معطَّل مسبقاً
    const activeAdminId = await createFixtureAccount("admin");

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await disableAccount(activeAdminId);

    expect(result.error).toBeTruthy();
    const [disabledRow] = await sql<{ disabled_at: string | null }[]>`
      select disabled_at from public.admin_profiles where id = ${disabledAdminId}
    `;
    expect(disabledRow.disabled_at).not.toBeNull(); // بقي معطَّلاً كما كان
  });
});

describe("disableAccount / enableAccount — تعطيل عكوس (reversible)", () => {
  test("تعطيل ثم تفعيل يُعيد الوصول (بلا حماية آخر Admin هنا لأنه staff)", async () => {
    const staffId = await createFixtureAccount("staff");

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const disableResult = await disableAccount(staffId);
    expect(disableResult.success).toBe(true);

    let [row] = await sql<{ disabled_at: string | null }[]>`
      select disabled_at from public.admin_profiles where id = ${staffId}
    `;
    expect(row.disabled_at).not.toBeNull();

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const enableResult = await enableAccount(staffId);
    expect(enableResult.success).toBe(true);

    [row] = await sql<{ disabled_at: string | null }[]>`
      select disabled_at from public.admin_profiles where id = ${staffId}
    `;
    expect(row.disabled_at).toBeNull();
  });
});

describe("deleteAccount — يحذف الصف حتى بدون SUPABASE_SERVICE_ROLE_KEY، مع تحذير واضح", () => {
  test("يحذف staff بنجاح ويُرجع warning (بدل الانهيار)", async () => {
    const staffId = await createFixtureAccount("staff");

    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await deleteAccount(staffId);

    expect(result.success).toBe(true);
    expect(result.warning).toBeTruthy();

    const rows = await sql`select id from public.admin_profiles where id = ${staffId}`;
    expect(rows).toHaveLength(0);
  });
});
