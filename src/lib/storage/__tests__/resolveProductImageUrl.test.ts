import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";

// resolveProductImageUrl تستعمل getSupabaseServiceRoleClient — نُحاكيها هنا
// فقط (بلا بيانات اعتماد Supabase حقيقية فبيئة الاختبار)، مع الإبقاء على
// كل شيء آخر حقيقياً (fs الفعلي، وenv الحقيقي عبر process.env).
const getSupabaseServiceRoleClientMock = vi.fn();
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: getSupabaseServiceRoleClientMock,
}));

const { resolveProductImageUrl, resolveProductImageUrls } = await import(
  "@/lib/storage/resolveProductImageUrl"
);

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

function fakeSupabaseClient(
  getPublicUrlImpl: (objectPath: string, bucket?: string) => { data: { publicUrl: string } }
) {
  const getPublicUrl = vi.fn(getPublicUrlImpl);
  return {
    storage: {
      from: vi.fn((bucket: string) => ({
        getPublicUrl: (objectPath: string) => getPublicUrl(objectPath, bucket),
      })),
    },
    __getPublicUrl: getPublicUrl,
  };
}

let localAbsPath: string;
const LOCAL_STORAGE_PATH = "product-images/__test-fixture__/local-only.png";

beforeEach(async () => {
  getSupabaseServiceRoleClientMock.mockReset();
  localAbsPath = path.join(process.cwd(), "public", LOCAL_STORAGE_PATH);
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  await fs.rm(path.dirname(localAbsPath), { recursive: true, force: true });
});

describe("resolveProductImageUrl — الصور القديمة (محلية) تبقى كما هي، والجديدة (Supabase Storage) تُحل بشكل صحيح", () => {
  test("ملف موجود محلياً: يرجع المسار المحلي، ولا يستدعي عميل Supabase إطلاقاً", async () => {
    await fs.mkdir(path.dirname(localAbsPath), { recursive: true });
    await fs.writeFile(localAbsPath, "x");

    const url = await resolveProductImageUrl(LOCAL_STORAGE_PATH);

    expect(url).toBe(`/${LOCAL_STORAGE_PATH}`);
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });

  test("ملف غير موجود محلياً وتخزين Supabase غير مُهيَّأ: يرجع المسار المحلي كملاذ أخير، بلا استثناء", async () => {
    clearRemoteStorageEnv();
    const nonExistentPath = "product-images/999999999/never-uploaded.png";

    const url = await resolveProductImageUrl(nonExistentPath);

    expect(url).toBe(`/${nonExistentPath}`);
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });

  test("ملف غير موجود محلياً وتخزين Supabase مُهيَّأ: يستعمل getPublicUrl بمسار الكائن بلا تكرار اسم الـbucket", async () => {
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient((objectPath) => ({
      data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/product-images/${objectPath}` },
    }));
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    const storagePath = "product-images/42/new-primary.webp";
    const url = await resolveProductImageUrl(storagePath);

    expect(client.storage.from).toHaveBeenCalledWith("product-images");
    // مسار الكائن المُمرَّر لـgetPublicUrl لا يحتوي بادئة "product-images/"
    // مكرَّرة — .from("product-images") تُضيف اسم الـbucket بنفسها.
    expect(client.__getPublicUrl).toHaveBeenCalledWith("42/new-primary.webp", "product-images");
    expect(url).toBe(
      "https://example.supabase.co/storage/v1/object/public/product-images/42/new-primary.webp"
    );
    expect(url).not.toContain("product-images/product-images/");
  });

  test("فشل الاتصال بـSupabase Storage عند الحل: يرجع المسار المحلي بدل رمي استثناء", async () => {
    configureRemoteStorageEnv();
    getSupabaseServiceRoleClientMock.mockImplementation(() => {
      throw new Error("network down");
    });

    const storagePath = "product-images/42/new-primary.webp";
    const url = await resolveProductImageUrl(storagePath);

    expect(url).toBe(`/${storagePath}`);
  });

  test("ملف قديم اسمه عربي/فيه مسافات (storage_path مُرمَّز كرابط) موجود محلياً، حتى لو كان تخزين Supabase مُهيَّأ فعلياً (حالة Production الحقيقية): يبقى مسار محلي، ولا يُستدعى Supabase إطلاقاً (regression لـTF-CK-009 وما شابهها)", async () => {
    // مُهيَّأ فعلياً هنا تحديداً لأن الخطأ الحقيقي في Production لا يظهر إلا
    // عندما يكون تخزين Supabase مُهيَّأ فعلاً (وإلا فالملاذ الأخير محلي بأي
    // حال ويُخفي الخلل) — نفس وضع Production الفعلي بعد إضافة رفع الصور.
    configureRemoteStorageEnv();
    const client = fakeSupabaseClient((objectPath) => ({
      data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/product-images/${objectPath}` },
    }));
    getSupabaseServiceRoleClientMock.mockReturnValue(client);

    const rawFilename = "09__يد كوكوة شنوة 2 تقاب صغيرة.png";
    const encodedStoragePath = `product-images/__test-fixture__/${encodeURIComponent(rawFilename)}`;
    const rawAbsPath = path.join(process.cwd(), "public", "product-images", "__test-fixture__", rawFilename);

    await fs.mkdir(path.dirname(rawAbsPath), { recursive: true });
    await fs.writeFile(rawAbsPath, "x");

    const url = await resolveProductImageUrl(encodedStoragePath);

    expect(url).toBe(`/${encodedStoragePath}`);
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });

  test("resolveProductImageUrls: يحل دفعة مسارات فريدة ويرجع كائناً عادياً (قابل للتمرير عبر props)", async () => {
    clearRemoteStorageEnv();
    await fs.mkdir(path.dirname(localAbsPath), { recursive: true });
    await fs.writeFile(localAbsPath, "x");

    const missingPath = "product-images/999999999/never-uploaded.png";
    const result = await resolveProductImageUrls([LOCAL_STORAGE_PATH, missingPath, LOCAL_STORAGE_PATH]);

    expect(result[LOCAL_STORAGE_PATH]).toBe(`/${LOCAL_STORAGE_PATH}`);
    expect(result[missingPath]).toBe(`/${missingPath}`);
    expect(Object.keys(result)).toHaveLength(2);
  });
});
