import { afterEach, describe, expect, test, vi } from "vitest";

const getSupabaseServiceRoleClientMock = vi.fn();
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: getSupabaseServiceRoleClientMock,
}));

const {
  canWriteProductImages,
  saveProductImageFile,
  deleteProductImageFile,
  StorageNotConfiguredError,
} = await import("@/lib/storage/productImages");

// حماية "ممنوع استعمال filesystem محلي فـVercel كحل للصور": نتحقق أن
// saveProductImageFile/deleteProductImageFile يرفضان بوضوح (StorageNotConfiguredError)
// بدل محاولة كتابة/حذف ستفشل حتماً (EROFS) عند تشغيلهما على Vercel بلا
// Supabase Storage حقيقي مُهيَّأ — هذا بالضبط سبب عطل الإنتاج بعد commit
// 3f4c00c (رسالة "تعذر حفظ الصورة" كانت ناتجة عن محاولة كتابة محلية فاشلة
// أدّت لاحقاً إلى فشل الصفحة).
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function clearRemoteStorageEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function pngFile(name: string): File {
  return new File([Buffer.from("x")], name, { type: "image/png" });
}

describe("لا استعمال لـfilesystem محلي على Vercel — فشل واضح بدل EROFS صامت", () => {
  test("canWriteProductImages(): true محلياً (بلا VERCEL)، false على Vercel بلا Supabase Storage مُهيَّأ", () => {
    clearRemoteStorageEnv();
    delete process.env.VERCEL;
    expect(canWriteProductImages()).toBe(true);

    process.env.VERCEL = "1";
    expect(canWriteProductImages()).toBe(false);
  });

  test("saveProductImageFile يرمي StorageNotConfiguredError على Vercel بلا تخزين مُهيَّأ، ولا يحاول أي كتابة محلية", async () => {
    clearRemoteStorageEnv();
    process.env.VERCEL = "1";

    await expect(
      saveProductImageFile(999999998, pngFile("x.png"))
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  test("deleteProductImageFile يرمي StorageNotConfiguredError على Vercel بلا تخزين مُهيَّأ", async () => {
    clearRemoteStorageEnv();
    process.env.VERCEL = "1";

    await expect(
      deleteProductImageFile("product-images/999999998/whatever.png")
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });
});

function configureRemoteStorageEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

function fakeSupabaseClient() {
  const upload = vi.fn<(objectKey: string, body: Buffer, opts: { contentType: string }) => Promise<{ error: null }>>(
    async () => ({ error: null })
  );
  const remove = vi.fn<(objectKeys: string[]) => Promise<{ error: null }>>(async () => ({ error: null }));
  const getPublicUrl = vi.fn((objectKey: string) => ({
    data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/product-images/${objectKey}` },
  }));
  return {
    storage: { from: vi.fn(() => ({ upload, remove, getPublicUrl })) },
    __upload: upload,
    __remove: remove,
    __getPublicUrl: getPublicUrl,
  };
}

describe("Supabase Storage مُهيَّأ فعلياً: saveProductImageFile يرجع رابطاً عاماً كاملاً، وdeleteProductImageFile يستخرج مفتاح الكائن الصحيح من كلتا الصيغتين", () => {
  afterEach(() => {
    getSupabaseServiceRoleClientMock.mockReset();
  });

  test("saveProductImageFile: يرفع الملف باسم UUID آمن ويرجع public URL الكامل الجاهز من getPublicUrl مباشرة", async () => {
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient();
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    const url = await saveProductImageFile(176, pngFile("original-name-not-used.png"));

    expect(client.storage.from).toHaveBeenCalledWith("product-images");
    expect(client.__upload).toHaveBeenCalledTimes(1);
    const uploadedKey = client.__upload.mock.calls[0][0] as string;
    expect(uploadedKey).toMatch(/^176\/[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`https://example.supabase.co/storage/v1/object/public/product-images/${uploadedKey}`);
  });

  test("deleteProductImageFile: مع رابط عام كامل (صورة جديدة)، يستخرج مفتاح الكائن الصحيح بعد /public/product-images/", async () => {
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient();
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    await deleteProductImageFile(
      "https://example.supabase.co/storage/v1/object/public/product-images/176/abc-123.webp"
    );

    expect(client.__remove).toHaveBeenCalledWith(["176/abc-123.webp"]);
  });

  test("deleteProductImageFile: مع مسار نسبي قديم بادئته product-images/، يستخرج نفس مفتاح الكائن كما كان دائماً", async () => {
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient();
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    await deleteProductImageFile("product-images/176/old-relative.png");

    expect(client.__remove).toHaveBeenCalledWith(["176/old-relative.png"]);
  });
});
