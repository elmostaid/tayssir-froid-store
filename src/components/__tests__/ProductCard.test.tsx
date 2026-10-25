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
    // كان التأكيد يفحص ترميز `/_next/image?url=…` الذي يُنتجه `<Image>`.
    // البطاقة صارت `<picture>` + `<img>` عادي (`images.unoptimized` يُلغي
    // أي تحسين من `<Image>` أصلاً)، فالرابط يصل كما هو — والقصد واحد:
    // المسار المحلي يُعرض حرفياً.
    expect(new URL(img.src).pathname).toBe(`/${storagePath}`);
    // وهو نفسه ما يسقط إليه حارس الصور عند أي فشل.
    expect(img.getAttribute("data-img-fallback")).toBe(`/${storagePath}`);
  });

  test("صورة مرفوعة حديثاً: تُعرض عبر /img/ من نطاق الموقع لا من رابط Supabase مباشرة", async () => {
    const publicUrl =
      "https://example.supabase.co/storage/v1/object/public/product-images/999999999/new-remote.webp";

    await renderProductCard({ product: baseProduct({ primary_image_path: publicUrl }), imageUrl: publicUrl });

    const img = screen.getByAltText("منتج اختبار") as HTMLImageElement;
    // Supabase على هذه الخطة تُرجع الصور بـno-cache مهما فعلنا عند الرفع،
    // فنُقدّمها من نطاقنا حيث نتحكّم في ترويسة التخزين المؤقّت.
    expect(new URL(img.src).pathname).toBe("/img/999999999/new-remote.webp");
    expect(img.src).not.toContain("example.supabase.co");
  });

  /**
   * الحارس الأول: صورة لم يُولِّد لها المولِّد نسخاً لا تُعلَن لها نسخة.
   * `<picture>` لا يتراجع عن 404 — فإعلان `srcset` بلا ملف = صورة مكسورة.
   */
  test("أصل غير مُعالَج: لا `<source>` WebP إطلاقاً، والأصل وحده يُعرض", async () => {
    const storagePath = "product-images/TF-NOT-PROCESSED/x.jpg";
    await renderProductCard({ product: baseProduct({ primary_image_path: storagePath }), imageUrl: storagePath });
    const img = screen.getByAltText("منتج اختبار") as HTMLImageElement;
    expect(img.closest("picture")?.querySelector("source")).toBeNull();
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  /**
   * المسار كاملاً من المانيفست الحقيقي إلى الوسم: TF-CK-001 من عيّنة
   * التجربة المُعالَجة فعلاً — لا محاكاة.
   */
  test("أصل مُعالَج: `<source type=\"image/webp\">` بنسختَي 360 و540، والأصل باقٍ في `<img>`", async () => {
    const storagePath = "product-images/TF-CK-001/TF-CK-001.jpg";
    await renderProductCard({ product: baseProduct({ primary_image_path: storagePath }), imageUrl: storagePath });
    const img = screen.getByAltText("منتج اختبار") as HTMLImageElement;
    const source = img.closest("picture")?.querySelector("source");
    expect(source?.getAttribute("type")).toBe("image/webp");
    expect(source?.getAttribute("srcset")).toMatch(/^\/_opt\/[0-9a-f]{16}-360\.webp 360w, \/_opt\/[0-9a-f]{16}-540\.webp 540w$/);
    // الأصل لا يُستبدل: هو `src` الوسم وهدف السقوط معاً.
    expect(new URL(img.src).pathname).toBe(`/${storagePath}`);
    expect(img.getAttribute("data-img-fallback")).toBe(`/${storagePath}`);
  });

  test("بدون صورة (imageUrl=null): يعرض 'بدون صورة' بدل محاولة حل أي رابط", async () => {
    await renderProductCard({ product: baseProduct({ primary_image_path: null }), imageUrl: null });

    expect(screen.getByText("بدون صورة")).toBeTruthy();
  });
});
