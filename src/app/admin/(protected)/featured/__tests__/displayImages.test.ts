import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
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

const { createFeaturedImageUploadTarget, commitFeaturedImage, resetFeaturedImage } = await import(
  "@/app/admin/(protected)/featured/displayImageActions"
);
const { removeFeaturedProduct } = await import("@/app/admin/(protected)/featured/actions");
const { getFeaturedDisplayImages } = await import("@/lib/queries/settings");

const ADMIN = { id: "a", email: "admin@local", role: "admin" as const };
const STAFF = { id: "s", email: "staff@local", role: "staff" as const };
const ids: number[] = [];

async function stored() {
  const [row] = await sql<{ value: Record<string, { path: string }> }[]>`
    select value from public.settings where key = 'featured_display_images'`;
  return row?.value ?? null;
}

async function upload(productId: number) {
  const target = await createFeaturedImageUploadTarget(productId, "image/jpeg");
  if (!target.objectPath) throw new Error(String(target.error));
  listMock.mockResolvedValue({ data: [{ name: target.objectPath.split("/").pop() }], error: null });
  return { target, result: await commitFeaturedImage(productId, target.objectPath) };
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active) values ('test-fixture-featured-img', 'تصنيف اختبار صور العرض', true)
    on conflict (slug) do update set is_active = true returning id`;
  await sql`delete from public.products where sku like 'TEST-FIXTURE-FIMG-%'`;
  for (let i = 1; i <= 3; i++) {
    const [p] = await sql<{ id: number }[]>`
      insert into public.products (sku, slug, category_id, name_ar, unit_label, min_order_qty, qty_increment, sale_price, stock_quantity, status, sort_order)
      values (${`TEST-FIXTURE-FIMG-${i}`}, ${`test-fixture-fimg-${i}`}, ${category.id}, ${`قطعة صورة عرض ${i}`}, 'قطعة', 1, 1, 50, 10, 'published', ${i})
      returning id`;
    ids.push(p.id);
  }
});

beforeEach(async () => {
  getAdminUserMock.mockResolvedValue(ADMIN);
  listMock.mockReset();
  await sql`delete from public.home_featured_products`;
  await sql`delete from public.settings where key = 'featured_display_images'`;
  await sql`insert into public.home_featured_products (product_id, position) values (${ids[0]}, 1), (${ids[1]}, 2)`;
});

afterAll(async () => {
  await sql`delete from public.home_featured_products`;
  await sql`delete from public.settings where key = 'featured_display_images'`;
  await sql`delete from public.products where sku like 'TEST-FIXTURE-FIMG-%'`;
});

describe("صورة العرض في «الأكثر طلباً»", () => {
  test("الموظف لا يغيّر الصور", async () => {
    getAdminUserMock.mockResolvedValue(STAFF);
    expect((await createFeaturedImageUploadTarget(ids[0], "image/jpeg")).error).toMatch(/مقصور/);
    expect((await resetFeaturedImage(ids[0])).error).toMatch(/مقصور/);
  });

  test("منتج غير موجود في القسم ⇒ رفض", async () => {
    expect((await createFeaturedImageUploadTarget(ids[2], "image/jpeg")).error).toMatch(/ليس في قسم/);
  });

  test("الرفع في مجلد المنتج نفسه، والحفظ يُقرأ كما تقرؤه الصفحة الرئيسية", async () => {
    const { target, result } = await upload(ids[0]);
    expect(target.objectPath).toMatch(new RegExp(`^featured/${ids[0]}/[0-9a-f-]{36}\\.jpg$`));
    expect(result).toEqual({ error: null, success: true });
    const read = await getFeaturedDisplayImages();
    expect(read[String(ids[0])]?.path).toBe(`${BASE}${target.objectPath}`);
  });

  test("مسار صورة منتج آخر ⇒ رفض ولا كتابة", async () => {
    const other = await createFeaturedImageUploadTarget(ids[1], "image/jpeg");
    expect((await commitFeaturedImage(ids[0], other.objectPath!)).error).toBe("مسار الصورة غير صالح.");
    expect(await stored()).toBeNull();
  });

  test("ملف لم يُرفع فعلاً ⇒ لا تشير إليه الصفحة", async () => {
    const t = await createFeaturedImageUploadTarget(ids[0], "image/jpeg");
    listMock.mockResolvedValue({ data: [], error: null });
    expect((await commitFeaturedImage(ids[0], t.objectPath!)).error).toMatch(/لم نجد/);
    expect(await stored()).toBeNull();
  });

  test("الرجوع لصورة المنتج يحذف مدخله وحده", async () => {
    await upload(ids[0]);
    await upload(ids[1]);
    await resetFeaturedImage(ids[0]);
    expect(Object.keys((await stored())!)).toEqual([String(ids[1])]);
  });

  test("إزالة المنتج من القسم تمحو صورة عرضه، والترتيب يبقى سليماً", async () => {
    await upload(ids[0]);
    await upload(ids[1]);
    expect(await removeFeaturedProduct(ids[0])).toEqual({ error: null });
    expect(Object.keys((await stored())!)).toEqual([String(ids[1])]);
    expect(await sql`select product_id, position from public.home_featured_products`).toEqual([{ product_id: ids[1], position: 1 }]);
  });

  test("صور المنتجات والمنتج نفسه لا يُمسّان", async () => {
    const before = await sql`select (select count(*)::int from public.product_images) imgs,
      (select row_to_json(p) from public.products p where id = ${ids[0]}) product`;
    await upload(ids[0]);
    await resetFeaturedImage(ids[0]);
    const after = await sql`select (select count(*)::int from public.product_images) imgs,
      (select row_to_json(p) from public.products p where id = ${ids[0]}) product`;
    expect(after).toEqual(before);
  });
});
