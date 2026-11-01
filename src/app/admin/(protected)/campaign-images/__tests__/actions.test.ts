import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>("@/lib/auth/requireAdmin");
  return { ...actual, getAdminUser: getAdminUserMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/storage/productImages", () => ({ isRemoteStorageConfigured: () => true }));

const BASE = "https://proj.supabase.co/storage/v1/object/public/product-images/";
const listMock = vi.fn();
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => ({ data: { path, token: "tok" }, error: null }),
        list: listMock,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${BASE}${path}` } }),
      }),
    },
  }),
}));

const { createCampaignImageUploadTarget, commitCampaignImage, resetCampaignImage } = await import(
  "@/app/admin/(protected)/campaign-images/actions"
);

const ADMIN = { id: "a", email: "admin@local", role: "admin" as const };
const STAFF = { id: "s", email: "staff@local", role: "staff" as const };

async function stored() {
  const [row] = await sql<{ value: Record<string, { path: string }> }[]>`
    select value from public.settings where key = 'campaign_card_images'`;
  return row?.value ?? null;
}

beforeEach(async () => {
  getAdminUserMock.mockResolvedValue(ADMIN);
  listMock.mockReset();
  await sql`delete from public.settings where key = 'campaign_card_images'`;
});
afterAll(async () => {
  await sql`delete from public.settings where key = 'campaign_card_images'`;
});

describe("صور بطاقات الحملات — لوحة الإدارة", () => {
  test("الموظف لا يغيّر الصور", async () => {
    getAdminUserMock.mockResolvedValue(STAFF);
    expect((await createCampaignImageUploadTarget("water-heaters:gas", "image/jpeg")).error).toMatch(/مقصور/);
    expect((await commitCampaignImage("water-heaters:gas", "x")).error).toMatch(/مقصور/);
  });

  test("خانة غير معروفة أو صيغة غير مدعومة ⇒ رفض", async () => {
    expect((await createCampaignImageUploadTarget("products:12", "image/jpeg")).error).toBeTruthy();
    expect((await createCampaignImageUploadTarget("water-heaters:gas", "image/gif")).error).toBeTruthy();
  });

  test("الرفع في مجلد الخانة وحدها، والحفظ صفّ إعدادات واحد يُدمج ولا يُستبدَل", async () => {
    const gas = await createCampaignImageUploadTarget("water-heaters:gas", "image/jpeg");
    expect(gas.objectPath).toMatch(/^campaign\/water-heaters-gas\/[0-9a-f-]{36}\.jpg$/);
    listMock.mockResolvedValue({ data: [{ name: gas.objectPath!.split("/").pop() }], error: null });
    expect(await commitCampaignImage("water-heaters:gas", gas.objectPath!)).toEqual({ error: null, success: true });

    const std = await createCampaignImageUploadTarget("washing-machines:standard", "image/png");
    listMock.mockResolvedValue({ data: [{ name: std.objectPath!.split("/").pop() }], error: null });
    await commitCampaignImage("washing-machines:standard", std.objectPath!);

    const value = await stored();
    expect(Object.keys(value!).sort()).toEqual(["washing-machines:standard", "water-heaters:gas"]);
    expect(value!["water-heaters:gas"].path).toBe(`${BASE}${gas.objectPath}`);
  });

  test("مسار من خانة أخرى أو من صور المنتجات ⇒ رفض، ولا كتابة", async () => {
    const other = await createCampaignImageUploadTarget("water-heaters:electric", "image/jpeg");
    expect((await commitCampaignImage("water-heaters:gas", other.objectPath!)).error).toBe("مسار الصورة غير صالح.");
    expect((await commitCampaignImage("water-heaters:gas", "12/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.jpg")).error).toBe("مسار الصورة غير صالح.");
    expect(await stored()).toBeNull();
  });

  test("ملف لم يُرفع فعلاً ⇒ لا تشير إليه الصفحة", async () => {
    const t = await createCampaignImageUploadTarget("water-heaters:gas", "image/jpeg");
    listMock.mockResolvedValue({ data: [], error: null });
    expect((await commitCampaignImage("water-heaters:gas", t.objectPath!)).error).toMatch(/لم نجد/);
    expect(await stored()).toBeNull();
  });

  test("الرجوع للصورة التلقائية يحذف الخانة وحدها", async () => {
    for (const slot of ["water-heaters:gas", "water-heaters:electric"]) {
      const t = await createCampaignImageUploadTarget(slot, "image/jpeg");
      listMock.mockResolvedValue({ data: [{ name: t.objectPath!.split("/").pop() }], error: null });
      await commitCampaignImage(slot, t.objectPath!);
    }
    await resetCampaignImage("water-heaters:gas");
    expect(Object.keys((await stored())!)).toEqual(["water-heaters:electric"]);
  });

  test("صور المنتجات لم تُلمس", async () => {
    const before = await sql`select count(*)::int n, max(id) m from public.product_images`;
    const t = await createCampaignImageUploadTarget("washing-machines:semi", "image/jpeg");
    listMock.mockResolvedValue({ data: [{ name: t.objectPath!.split("/").pop() }], error: null });
    await commitCampaignImage("washing-machines:semi", t.objectPath!);
    expect(await sql`select count(*)::int n, max(id) m from public.product_images`).toEqual(before);
  });
});

describe("ما يُحفظ هو ما تقرؤه الصفحة", () => {
  test("بعد الحفظ، قارئ الصفحة يعيد الصورة اليدوية للخانة", async () => {
    const { getCampaignImageOverrides } = await import("@/lib/queries/settings");
    const t = await createCampaignImageUploadTarget("water-heaters:electric", "image/jpeg");
    listMock.mockResolvedValue({ data: [{ name: t.objectPath!.split("/").pop() }], error: null });
    await commitCampaignImage("water-heaters:electric", t.objectPath!);
    const overrides = await getCampaignImageOverrides();
    expect(overrides["water-heaters:electric"]?.path).toBe(`${BASE}${t.objectPath}`);
  });
});
