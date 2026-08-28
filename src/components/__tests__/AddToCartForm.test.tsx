import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import { AddToCartForm } from "@/components/AddToCartForm";
import type { CatalogProduct } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const trackAddToCartMock = vi.fn();
vi.mock("@/lib/pixel/fbq", () => ({
  trackAddToCart: (...args: unknown[]) => trackAddToCartMock(...args),
}));

afterEach(() => {
  cleanup();
  trackAddToCartMock.mockReset();
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
  pricing_mode: "single",
  tier2_min_qty: null,
  tier2_price: null,
  tier3_min_qty: null,
  tier3_price: null,
  show_bulk_whatsapp: false,
  status: "published",
};

function renderForm() {
  return render(
    <CartProvider>
      <AddToCartForm product={PRODUCT} variants={[]} imageUrl={null} />
    </CartProvider>
  );
}

describe("AddToCartForm — AddToCart يُطلَق فقط عند الإضافة الفعلية للسلة", () => {
  test("فتح الصفحة (mount) وحده لا يُطلِق AddToCart", () => {
    renderForm();
    expect(trackAddToCartMock).not.toHaveBeenCalled();
  });

  test("تغيير الكمية (+/-) وحده لا يُطلِق AddToCart", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "زيادة الكمية" }));
    expect(trackAddToCartMock).not.toHaveBeenCalled();
  });

  test("الضغط على 'أضف إلى السلة': يُطلِق AddToCart مرة واحدة بالقيم الصحيحة (السعر × الكمية، SKU، MAD)", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "أضف إلى السلة" }));

    expect(trackAddToCartMock).toHaveBeenCalledTimes(1);
    expect(trackAddToCartMock).toHaveBeenCalledWith({
      sku: "TF-TEST-001",
      name: "منتج اختبار",
      price: 75.5,
      quantity: 2, // min_order_qty الافتراضية
      category: "تصنيف اختبار",
    });
  });

  test("نقرتان منفصلتان على 'أضف إلى السلة': يُطلِق AddToCart مرتين (سلوك متوقَّع — إضافتان حقيقيتان منفصلتان)", () => {
    renderForm();
    const btn = screen.getByRole("button", { name: "أضف إلى السلة" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(trackAddToCartMock).toHaveBeenCalledTimes(2);
  });
});
