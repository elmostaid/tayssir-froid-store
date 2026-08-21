import { afterEach, describe, expect, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CatalogProduct } from "@/lib/types";
import { CartProvider } from "@/components/CartProvider";
import { ProductCard } from "@/components/ProductCard";

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

afterEach(() => {
  cleanup();
});

describe("ProductCard — يحل رابط الصورة عبر resolveProductImageUrl (نفس المصدر المركزي، بسيط ومباشر)", () => {
  test("صورة محلية قديمة (storage_path نسبي): تُعرض بمسارها المحلي كما هو حرفياً", async () => {
    const storagePath = "product-images/TF-CK-009/09__%D9%8A%D8%AF.png";

    await renderProductCard({ product: baseProduct({ primary_image_path: storagePath }), imageUrl: storagePath });

    const img = screen.getByAltText("منتج اختبار") as HTMLImageElement;
    expect(img.src).toContain(encodeURIComponent(`/${storagePath}`));
  });

  test("صورة مرفوعة حديثاً: تُعرض عبر /img/ من نطاق الموقع لا من رابط Supabase مباشرة", async () => {
    const publicUrl =
      "https://example.supabase.co/storage/v1/object/public/product-images/999999999/new-remote.webp";

    await renderProductCard({ product: baseProduct({ primary_image_path: publicUrl }), imageUrl: publicUrl });

    const img = screen.getByAltText("منتج اختبار") as HTMLImageElement;
    // Supabase على هذه الخطة تُرجع الصور بـno-cache مهما فعلنا عند الرفع،
    // فنُقدّمها من نطاقنا حيث نتحكّم في ترويسة التخزين المؤقّت.
    expect(img.src).toContain(encodeURIComponent("/img/999999999/new-remote.webp"));
    expect(img.src).not.toContain("example.supabase.co");
  });

  test("بدون صورة (imageUrl=null): يعرض 'بدون صورة' بدل محاولة حل أي رابط", async () => {
    await renderProductCard({ product: baseProduct({ primary_image_path: null }), imageUrl: null });

    expect(screen.getByText("بدون صورة")).toBeTruthy();
  });
});
