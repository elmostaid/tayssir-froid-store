import { afterEach, describe, expect, test, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";

const getSupabaseServiceRoleClientMock = vi.fn();
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: getSupabaseServiceRoleClientMock,
}));

const { resolveCartImageUrls } = await import("@/app/(storefront)/cart/resolveCartImageUrls");

const ORIGINAL_ENV = { ...process.env };

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  getSupabaseServiceRoleClientMock.mockReset();
  await fs.rm(path.join(process.cwd(), "public", "product-images", "__test-fixture-cart__"), {
    recursive: true,
    force: true,
  });
});

// resolveCartImageUrls غلاف رقيق فقط حول resolveProductImageUrls المركزي —
// السلة (localStorage جانب العميل) تخزّن storage_path خام فقط، وهذا الإجراء
// هو الجسر الوحيد المسموح به لحلّه من جهة الخادم (fs غير متاح فمكوّن
// "use client"). لا منطق حل مختلف هنا.
describe("resolveCartImageUrls — نفس resolveProductImageUrls المركزي، بلا منطق إضافي", () => {
  test("يحل مسارات السلة الحقيقية ويتجاهل القيم الفارغة/null بأمان", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const storagePath = "product-images/__test-fixture-cart__/local.png";
    const absPath = path.join(process.cwd(), "public", storagePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, "x");

    const result = await resolveCartImageUrls([storagePath, "", null as unknown as string]);

    expect(result[storagePath]).toBe(`/${storagePath}`);
    expect(Object.keys(result)).toHaveLength(1);
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });
});
