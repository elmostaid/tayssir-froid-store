import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import { AddToCartForm } from "@/components/AddToCartForm";
import { ProductCardActions } from "@/components/ProductCardActions";
import type { CatalogProduct, CatalogProductVariant } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// المساران الآخران مُعطَّلان: هذا الملف يختبر GA4 وحده.
vi.mock("@/lib/pixel/fbq", () => ({ trackAddToCart: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ trackAnalyticsEvent: vi.fn() }));

const gaAddToCartMock = vi.fn();
vi.mock("@/lib/ga/ecommerce", () => ({
  trackGaAddToCart: (...args: unknown[]) => gaAddToCartMock(...args),
}));

afterEach(() => {
  cleanup();
  gaAddToCartMock.mockReset();
  window.localStorage.clear();
});

const PRODUCT: CatalogProduct = {
  id: 1,
  sku: "TF-TEST-001",
  slug: "test-product",
  category_id: 5,
  category_slug: "test-category",
  category_name_ar: "تصنيف اختبار",
  name_ar: "منتج اختبار",
  name_fr: null,
  description_ar: null,
  technical_specs: null,
  unit_label: "قطعة",
  min_order_qty: 2,
  qty_increment: 1,
  sale_price: "75.50",
  stock_quantity: 10,
  meta_title: null,
  meta_description: null,
  primary_image_path: null,
  status: "published",
};

const VARIANT: CatalogProductVariant = {
  id: 9,
  product_id: 1,
  variant_name: "مقاس كبير",
  sale_price: "90",
  min_order_qty: 3,
  qty_increment: 1,
  stock_quantity: 8,
  sort_order: 1,
};

describe("GA4 add_to_cart — من صفحة المنتج", () => {
  function renderForm(variants: CatalogProductVariant[] = []) {
    return render(
      <CartProvider>
        <AddToCartForm product={PRODUCT} variants={variants} imageUrl={null} />
      </CartProvider>
    );
  }

  test("مجرد فتح الصفحة أو تغيير الكمية لا يُطلِق add_to_cart", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "زيادة الكمية" }));
    expect(gaAddToCartMock).not.toHaveBeenCalled();
  });

  test("الإضافة الفعلية: منتج وسعر وكمية صحيحة، والتصنيف معها", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /أضف إلى السلة/ }));

    expect(gaAddToCartMock).toHaveBeenCalledTimes(1);
    expect(gaAddToCartMock).toHaveBeenCalledWith({
      sku: "TF-TEST-001",
      name: "منتج اختبار",
      price: 75.5,
      quantity: 2,
      category: "تصنيف اختبار",
    });
  });

  test("مع مقاس مختار: السعر والكمية يتبعان المقاس لا المنتج الأساسي", () => {
    renderForm([VARIANT]);
    fireEvent.click(screen.getByRole("button", { name: /أضف إلى السلة/ }));

    expect(gaAddToCartMock).toHaveBeenCalledWith(
      expect.objectContaining({ price: 90, quantity: 3 })
    );
  });
});

describe("GA4 add_to_cart — من بطاقة المنتج (الإضافة السريعة)", () => {
  test("الإضافة السريعة تُحتسب أيضاً، بالكمية الدنيا", () => {
    render(
      <CartProvider>
        <ProductCardActions
          product={PRODUCT}
          imageUrl={null}
          hasVariants={false}
          whatsappNumber="+212600000000"
        />
      </CartProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /أضف للسلة/ }));

    expect(gaAddToCartMock).toHaveBeenCalledTimes(1);
    expect(gaAddToCartMock).toHaveBeenCalledWith({
      sku: "TF-TEST-001",
      name: "منتج اختبار",
      price: 75.5,
      quantity: 2,
      category: "تصنيف اختبار",
    });
  });
});
