import { afterEach, describe, expect, test } from "vitest";
import {
  canWriteProductImages,
  saveProductImageFile,
  deleteProductImageFile,
  StorageNotConfiguredError,
} from "@/lib/storage/productImages";

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
