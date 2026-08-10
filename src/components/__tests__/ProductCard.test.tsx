import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { promises as fs } from "fs";
import path from "path";
import type { CatalogProduct } from "@/lib/types";
import { CartProvider } from "@/components/CartProvider";

// ProductCard تستعمل الآن resolveProductImageUrl (server-only)، التي تعتمد
// على getSupabaseServiceRoleClient — نُحاكيها هنا فقط (بلا بيانات اعتماد
// Supabase حقيقية فبيئة الاختبار)، مع الإبقاء على fs الفعلي.
const getSupabaseServiceRoleClientMock = vi.fn();
vi.mock("@/lib/supabase/serviceRole", () => ({
  getSupabaseServiceRoleClient: getSupabaseServiceRoleClientMock,
}));

const { ProductCard } = await import("@/components/ProductCard");

const ORIGINAL_ENV = { ...process.env };

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

function baseProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 1,
    sku: "TF-TEST-001",
    slug: "test-product",
    category_id: 1,
    category_slug: "test-category",
    category_name_ar: "تصنيف اختبار",
    name_ar: "منتج اختبار",
    name_fr: null,
    description_ar: null,
    technical_specs: null,
    unit_label: "قطعة",
    min_order_qty: 1,
    qty_increment: 1,
    sale_price: "99.00",
    stock_quantity: 10,
    meta_title: null,
    meta_description: null,
    primary_image_path: null,
    status: "published",
    ...overrides,
  };
}

async function renderProductCard(props: {
  product: CatalogProduct;
  imageUrl: string | null;
}) {
  const element = await ProductCard({ ...props, whatsappNumber: "212600000000" });
  render(<CartProvider>{element}</CartProvider>);
}

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  getSupabaseServiceRoleClientMock.mockReset();
  cleanup();
  await fs.rm(path.join(process.cwd(), "public", "product-images", "__test-fixture-productcard__"), {
    recursive: true,
    force: true,
  });
});

describe("ProductCard — يحل رابط الصورة عبر resolveProductImageUrl (نفس المصدر المركزي)", () => {
  test("صورة محلية قديمة موجودة فعلياً: تُعرض بمسارها المحلي", async () => {
    clearRemoteStorageEnv();
    const storagePath = "product-images/__test-fixture-productcard__/local.png";
    const absPath = path.join(process.cwd(), "public", storagePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, "x");

    await renderProductCard({ product: baseProduct({ primary_image_path: storagePath }), imageUrl: storagePath });

    const img = screen.getByAltText("منتج اختبار") as HTMLImageElement;
    expect(img.src).toContain(encodeURIComponent(`/${storagePath}`));
  });

  test("صورة مرفوعة حديثاً إلى Supabase Storage (لا وجود لها محلياً): تُعرض عبر public URL الصحيح", async () => {
    configureRemoteStorageEnv();
    const storagePath = "product-images/999999999/new-remote.webp";
    const publicUrl = "https://example.supabase.co/storage/v1/object/public/product-images/999999999/new-remote.webp";
    getSupabaseServiceRoleClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          getPublicUrl: vi.fn(() => ({ data: { publicUrl } })),
        })),
      },
    });

    await renderProductCard({ product: baseProduct({ primary_image_path: storagePath }), imageUrl: storagePath });

    const img = screen.getByAltText("منتج اختبار") as HTMLImageElement;
    expect(img.src).toContain(encodeURIComponent(publicUrl));
  });

  test("بدون صورة (imageUrl=null): يعرض 'بدون صورة' بدل محاولة حل أي رابط", async () => {
    clearRemoteStorageEnv();
    await renderProductCard({ product: baseProduct({ primary_image_path: null }), imageUrl: null });

    expect(screen.getByText("بدون صورة")).toBeTruthy();
    expect(getSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });
});
