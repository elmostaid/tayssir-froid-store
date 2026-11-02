import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>("@/lib/auth/requireAdmin");
  return { ...actual, getAdminUser: getAdminUserMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/storage/remoteStorage", () => ({ isRemoteStorageConfigured: () => true, canWriteProductImages: () => true }));

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

const actions = await import("@/app/admin/(protected)/campaign-images/sectionActions");
const { getCampaignSectionsFresh } = await import("@/lib/queries/settings");

const SLOT = "washing-machines:standard";
const ADMIN = { id: "a", email: "admin@local", role: "admin" as const };
const STAFF = { id: "s", email: "staff@local", role: "staff" as const };
const NAMES = ["موطور اختبار 150 واط", "موطور اختبار نشاف", "منتري اختبار", "بولي اختبار", "جلدة اختبار", "قفل اختبار"];
const ids: number[] = [];
let otherCategoryProduct = 0;

async function entries() {
  return (await getCampaignSectionsFresh())[SLOT] ?? [];
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active) values ('standard-washing-machine-parts', 'قطع مكينة الصابون العادية', true)
    on conflict (slug) do update set is_active = public.categories.is_active returning id`;
  const [other] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active) values ('test-fixture-sections-other', 'تصنيف اختبار آخر', true)
    on conflict (slug) do update set is_active = true returning id`;
  await sql`delete from public.products where sku like 'TEST-FIXTURE-SEC-%'`;
  for (const [index, name] of NAMES.entries()) {
    const [p] = await sql<{ id: number }[]>`
      insert into public.products (sku, slug, category_id, name_ar, unit_label, min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order)
      values (${`TEST-FIXTURE-SEC-${index}`}, ${`test-fixture-sec-${index}`}, ${category.id}, ${name}, 'قطعة', 2, 1, 40, 10, 'published', ${index})
      returning id`;
    ids.push(p.id);
  }
  const [p] = await sql<{ id: number }[]>`
    insert into public.products (sku, slug, category_id, name_ar, unit_label, min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order)
    values ('TEST-FIXTURE-SEC-X', 'test-fixture-sec-x', ${other.id}, 'كروازي من تصنيف آخر', 'قطعة', 1, 1, 40, 10, 'published', 1)
    returning id`;
  otherCategoryProduct = p.id;
});

beforeEach(async () => {
  getAdminUserMock.mockResolvedValue(ADMIN);
  listMock.mockReset();
  await sql`delete from public.settings where key = 'campaign_section_products'`;
});

afterAll(async () => {
  await sql`delete from public.settings where key = 'campaign_section_products'`;
  await sql`delete from public.products where sku like 'TEST-FIXTURE-SEC-%'`;
  await sql`delete from public.categories where slug = 'test-fixture-sections-other'`;
});

describe("اختيار منتجات أقسام /washing-machines", () => {
  test("الموظف لا يغيّر الأقسام", async () => {
    getAdminUserMock.mockResolvedValue(STAFF);
    expect((await actions.addSectionProduct(SLOT, ids[0])).error).toMatch(/مقصور/);
    expect((await actions.moveSectionProduct(SLOT, ids[0], 1)).error).toMatch(/مقصور/);
    expect((await actions.removeSectionProduct(SLOT, ids[0])).error).toMatch(/مقصور/);
    expect(await actions.searchSectionProducts(SLOT, "")).toEqual({ error: expect.stringMatching(/مقصور/) });
    expect(await entries()).toEqual([]);
  });

  test("قسم الشوفو أو قسم مجهول ⇒ رفض", async () => {
    expect((await actions.addSectionProduct("water-heaters:gas", ids[0])).error).toMatch(/قسم غير معروف/);
  });

  test("إضافة بالترتيب، ورفض صنف مكرّر ومنتج من تصنيف آخر ومنتج مكرّر", async () => {
    expect((await actions.addSectionProduct(SLOT, ids[0])).error).toBeNull();
    expect((await actions.addSectionProduct(SLOT, ids[2])).error).toBeNull();
    const clash = await actions.addSectionProduct(SLOT, ids[1]);
    expect(clash.error).toMatch(/يوجد «موطور»/);
    expect((await actions.addSectionProduct(SLOT, ids[0])).error).toMatch(/موجود/);
    expect((await actions.addSectionProduct(SLOT, otherCategoryProduct)).error).toMatch(/ليس من هذا النوع/);
    expect((await entries()).map((entry) => entry.productId)).toEqual([ids[0], ids[2]]);
  });

  test("الحد 4 منتجات", async () => {
    for (const id of [ids[0], ids[2], ids[3], ids[4]]) expect((await actions.addSectionProduct(SLOT, id)).error).toBeNull();
    expect((await actions.addSectionProduct(SLOT, ids[5])).error).toMatch(/ممتلئ/);
  });

  test("الترتيب والإزالة", async () => {
    for (const id of [ids[0], ids[2], ids[3]]) await actions.addSectionProduct(SLOT, id);
    expect((await actions.moveSectionProduct(SLOT, ids[3], 1)).error).toBeNull();
    expect((await entries()).map((entry) => entry.productId)).toEqual([ids[3], ids[0], ids[2]]);
    expect((await actions.moveSectionProduct(SLOT, ids[3], 9)).error).toBeNull();
    expect((await entries()).map((entry) => entry.productId)).toEqual([ids[0], ids[2], ids[3]]);
    expect((await actions.moveSectionProduct(SLOT, ids[3], 0)).error).toMatch(/رقم مرتبة/);
    expect((await actions.removeSectionProduct(SLOT, ids[0])).error).toBeNull();
    expect((await entries()).map((entry) => entry.productId)).toEqual([ids[2], ids[3]]);
    // بعد الإزالة يصير الصنف متاحاً من جديد.
    expect((await actions.addSectionProduct(SLOT, ids[1])).error).toBeNull();
  });

  test("البحث داخل التصنيف وحده، مع الصنف", async () => {
    const found = await actions.searchSectionProducts(SLOT, "اختبار");
    if ("error" in found) throw new Error(found.error);
    expect(found.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(found.find((row) => row.id === ids[0])?.family).toBe("موطور");
    const none = await actions.searchSectionProducts(SLOT, "كروازي");
    expect(none).toEqual([]);
  });

  test("صورة العرض: مجلد الخانة والمنتج، تثبيت المنتج إن كان تلقائياً، والرجوع لا يمسّ product_images", async () => {
    const before = await sql`select count(*)::int as n from public.product_images where product_id in ${sql(ids)}`;
    const target = await actions.createSectionImageUploadTarget(SLOT, ids[4], "image/jpeg");
    expect(target.objectPath).toMatch(new RegExp(`^campaign-products/washing-machines-standard/${ids[4]}/[0-9a-f-]{36}\\.jpg$`));
    listMock.mockResolvedValue({ data: [{ name: target.objectPath!.split("/").pop() }], error: null });
    expect((await actions.commitSectionImage(SLOT, ids[4], target.objectPath!)).error).toBeNull();
    const saved = await entries();
    expect(saved).toEqual([{ productId: ids[4], image: `${BASE}${target.objectPath}` }]);

    // مسار منتج آخر ⇒ رفض.
    expect((await actions.commitSectionImage(SLOT, ids[3], target.objectPath!)).error).toMatch(/مسار/);
    // ملف غير مرفوع ⇒ رفض.
    listMock.mockResolvedValue({ data: [], error: null });
    const ghost = await actions.createSectionImageUploadTarget(SLOT, ids[4], "image/jpeg");
    expect((await actions.commitSectionImage(SLOT, ids[4], ghost.objectPath!)).error).toMatch(/لم نجد/);
    // منتج من تصنيف آخر ⇒ رفض.
    expect((await actions.createSectionImageUploadTarget(SLOT, otherCategoryProduct, "image/jpeg")).error).toMatch(/ليس من هذا النوع/);

    expect((await actions.resetSectionImage(SLOT, ids[4])).error).toBeNull();
    expect(await entries()).toEqual([{ productId: ids[4] }]);
    const after = await sql`select count(*)::int as n from public.product_images where product_id in ${sql(ids)}`;
    expect(after[0].n).toBe(before[0].n);
  });

  test("الإزالة تنسى الصورة، والأقسام الأخرى لا تتأثّر", async () => {
    await sql`insert into public.settings (key, value) values ('campaign_section_products', ${sql.json({
      "washing-machines:semi": [{ productId: 77 }],
    })})`;
    await actions.addSectionProduct(SLOT, ids[0]);
    await actions.removeSectionProduct(SLOT, ids[0]);
    const config = await getCampaignSectionsFresh();
    expect(config["washing-machines:semi"]).toEqual([{ productId: 77 }]);
    expect(config[SLOT]).toBeUndefined();
  });
});
