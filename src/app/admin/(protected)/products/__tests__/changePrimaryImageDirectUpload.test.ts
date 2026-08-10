import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

// نفس نمط الاختبارات الأخرى فهذا الملف: getAdminUser() تحتاج جلسة Supabase
// Auth حقيقية غير متاحة فبيئة الاختبار — نُحاكيها هنا فقط.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getSupabaseServiceRoleClientMock = vi.fn();
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: getSupabaseServiceRoleClientMock,
}));

const { createPrimaryImageUploadTarget, commitPrimaryImage } = await import(
  "@/app/admin/(protected)/products/imageActions"
);

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

const ORIGINAL_ENV = { ...process.env };
function configureRemoteStorageEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}
function clearRemoteStorageEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function fakeSupabaseClient(objectExistsInListing = true) {
  const createSignedUploadUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://example.supabase.co/storage/v1/upload/sign/${path}`, token: "fake-token", path },
    error: null,
  }));
  const list = vi.fn(async (_dir: string, options: { search: string }) => ({
    data: objectExistsInListing ? [{ name: options.search }] : [],
    error: null,
  }));
  const getPublicUrl = vi.fn((objectKey: string) => ({
    data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/product-images/${objectKey}` },
  }));
  return {
    storage: {
      from: vi.fn(() => ({ createSignedUploadUrl, list, getPublicUrl })),
    },
    __createSignedUploadUrl: createSignedUploadUrl,
    __list: list,
    __getPublicUrl: getPublicUrl,
  };
}

let productId: number;
let originalImageId: number;
const OLD_STORAGE_PATH_SUFFIX = "old-test-primary.png";

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-DIRECTUPLOAD', 'test-fixture-directupload', ${category.id},
      'منتج اختبار الرفع المباشر', 'قطعة', 3, 1, 55.00, 99.00, 40, 'published'
    )
    on conflict (sku) do update set
      purchase_price = 55.00, sale_price = 99.00, stock_quantity = 40,
      min_order_qty = 3, status = 'published'
    returning id
  `;
  productId = product.id;

  await sql`delete from public.product_images where product_id = ${productId}`;
  const [image] = await sql<{ id: number }[]>`
    insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
    values (${productId}, ${`product-images/${productId}/${OLD_STORAGE_PATH_SUFFIX}`}, 'صورة اختبار قديمة', 1, true)
    returning id
  `;
  originalImageId = image.id;
});

beforeEach(() => {
  getSupabaseServiceRoleClientMock.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterAll(async () => {
  await sql`delete from public.product_images where product_id = ${productId}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-DIRECTUPLOAD'`;
});

describe("createPrimaryImageUploadTarget — تحضير رفع مباشر بدون تمرير الملف عبر Server Action", () => {
  test("Staff: يُرفَض قبل أي محاولة اتصال بـSupabase", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    configureRemoteStorageEnv();

    const result = await createPrimaryImageUploadTarget(productId, "image/png");

    expect(result.error).toBeTruthy();
    expect(result.uploadUrl).toBeUndefined();
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });

  test("نوع ملف غير مدعوم: يُرفَض بلا أي اتصال بـSupabase", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    configureRemoteStorageEnv();

    const result = await createPrimaryImageUploadTarget(productId, "application/pdf");

    expect(result.error).toBeTruthy();
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });

  test("تخزين Supabase غير مُهيَّأ: رسالة واضحة بدل محاولة ستفشل", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    clearRemoteStorageEnv();

    const result = await createPrimaryImageUploadTarget(productId, "image/png");

    expect(result.error).toContain("رفع الصور غير مُفعَّل");
  });

  test("نجاح: يولّد اسم كائن UUID آمن تحت {productId}/ ويرجع رابط الرفع الموقَّع", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient();
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    const result = await createPrimaryImageUploadTarget(productId, "image/webp");

    expect(result.error).toBeNull();
    expect(result.token).toBe("fake-token");
    expect(result.objectPath).toMatch(new RegExp(`^${productId}/[0-9a-f-]{36}\\.webp$`));
    expect(client.__createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });
});

describe("commitPrimaryImage — تحديث storage_path فقط بعد التأكد من الرفع الفعلي", () => {
  test("Staff: يُرفَض ولا يتغيّر شيء", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    configureRemoteStorageEnv();

    const result = await commitPrimaryImage(productId, `${productId}/${"a".repeat(8)}-1111-2222-3333-${"b".repeat(12)}.png`);

    expect(result.error).toBeTruthy();
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });

  test("objectPath غير صالح (لا يطابق UUID.ext): يُرفَض بلا أي تغيير", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    configureRemoteStorageEnv();

    const result = await commitPrimaryImage(productId, `${productId}/not-a-real-uuid.png`);

    expect(result.error).toBeTruthy();
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();

    const rows = await sql<{ storage_path: string }[]>`
      select storage_path from public.product_images where product_id = ${productId}
    `;
    expect(rows[0].storage_path).toContain(OLD_STORAGE_PATH_SUFFIX);
  });

  test("objectPath يخص منتجاً آخر (تلاعب): يُرفَض بلا أي تغيير", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    configureRemoteStorageEnv();

    const foreignPath = `999999999/aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb.png`;
    const result = await commitPrimaryImage(productId, foreignPath);

    expect(result.error).toBeTruthy();
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });

  test("الكائن غير موجود فعلياً فالتخزين (فشل رفع صامت أو ادّعاء كاذب): لا تغيير فـDB", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient(false);
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    const objectPath = `${productId}/aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb.png`;
    const result = await commitPrimaryImage(productId, objectPath);

    expect(result.error).toBeTruthy();
    expect(result.success).toBeFalsy();

    const rows = await sql<{ storage_path: string }[]>`
      select storage_path from public.product_images where product_id = ${productId}
    `;
    expect(rows[0].storage_path).toContain(OLD_STORAGE_PATH_SUFFIX);
  });

  test("نجاح: يحدّث storage_path لنفس السجل (لا سجل جديد)، ولا يحذف الصورة القديمة إطلاقاً", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient(true);
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    const objectPath = `${productId}/aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb.webp`;
    const result = await commitPrimaryImage(productId, objectPath);

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();

    const rows = await sql<
      { id: number; storage_path: string; is_primary: boolean }[]
    >`select id, storage_path, is_primary from public.product_images where product_id = ${productId}`;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(originalImageId);
    expect(rows[0].is_primary).toBe(true);
    expect(rows[0].storage_path).toBe(
      `https://example.supabase.co/storage/v1/object/public/product-images/${objectPath}`
    );

    // بقية بيانات المنتج بلا تغيير.
    const [product] = await sql<{ sale_price: string; stock_quantity: number }[]>`
      select sale_price, stock_quantity from public.products where id = ${productId}
    `;
    expect(Number(product.sale_price)).toBe(99);
    expect(product.stock_quantity).toBe(40);
  });
});
