import { afterEach, describe, expect, test, vi } from "vitest";

const getSupabaseServiceRoleClientMock = vi.fn();
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: getSupabaseServiceRoleClientMock,
}));

const { canWriteProductImages, deleteProductImageFile, StorageNotConfiguredError } = await import(
  "@/lib/storage/productImages"
);

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function clearRemoteStorageEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function configureRemoteStorageEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

// رفع الصور دائماً مباشر من المتصفح إلى Supabase Storage (لا مسار محلي بديل
// للرفع إطلاقاً منذ إزالة saveProductImageFile) — canWriteProductImages()
// تعكس هذا بدقة: true فقط عند تهيئة Supabase Storage الحقيقي، بغض النظر عن
// Vercel أو التطوير المحلي.
describe("canWriteProductImages — الرفع مباشر إلى Supabase Storage دائماً، بلا مسار محلي بديل", () => {
  test("false بلا تخزين Supabase مُهيَّأ، حتى محلياً بلا VERCEL", () => {
    clearRemoteStorageEnv();
    delete process.env.VERCEL;
    expect(canWriteProductImages()).toBe(false);
  });

  test("true فقط عند تهيئة Supabase Storage الحقيقي بالكامل", () => {
    configureRemoteStorageEnv();
    expect(canWriteProductImages()).toBe(true);
  });
});

describe("deleteProductImageFile يرمي StorageNotConfiguredError على Vercel بلا تخزين مُهيَّأ", () => {
  test("لا يحاول أي حذف محلي على Vercel بلا Supabase Storage", async () => {
    clearRemoteStorageEnv();
    process.env.VERCEL = "1";

    await expect(
      deleteProductImageFile("product-images/999999998/whatever.png")
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });
});

function fakeSupabaseClient() {
  const remove = vi.fn<(objectKeys: string[]) => Promise<{ error: null }>>(async () => ({ error: null }));
  return {
    storage: { from: vi.fn(() => ({ remove })) },
    __remove: remove,
  };
}

describe("Supabase Storage مُهيَّأ فعلياً: deleteProductImageFile يستخرج مفتاح الكائن الصحيح من كلتا الصيغتين", () => {
  afterEach(() => {
    getSupabaseServiceRoleClientMock.mockReset();
  });

  test("مع رابط عام كامل (صورة جديدة)، يستخرج مفتاح الكائن الصحيح بعد /public/product-images/", async () => {
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient();
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    await deleteProductImageFile(
      "https://example.supabase.co/storage/v1/object/public/product-images/176/abc-123.webp"
    );

    expect(client.__remove).toHaveBeenCalledWith(["176/abc-123.webp"]);
  });

  test("مع مسار نسبي قديم بادئته product-images/، يستخرج نفس مفتاح الكائن كما كان دائماً", async () => {
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient();
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    await deleteProductImageFile("product-images/176/old-relative.png");

    expect(client.__remove).toHaveBeenCalledWith(["176/old-relative.png"]);
  });
});
