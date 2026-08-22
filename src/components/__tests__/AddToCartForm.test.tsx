import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import { AddToCartForm } from "@/components/AddToCartForm";
import type { CatalogProduct, CatalogProductVariant } from "@/lib/types";

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

/**
 * الجسر المبكّر على صفحة المنتج.
 *
 * قِسْنا على Preview (4G بطيء + CPU ×4) أن أول ضغطة ناجحة على هذه الصفحة
 * كانت تحتاج 4554ms و7 ضغطات: الزرّ يظهر مبكّراً ولا يستجيب حتى يصل React.
 * البطاقات في الصفحة الرئيسية عولجت بجسر مضمَّن يقرأ data-early-add، وهذه
 * الاختبارات تحرس تطبيق نفس الحل هنا — وحدود أمانه.
 */
const VARIANT: CatalogProductVariant = {
  id: 91,
  product_id: 1,
  variant_name: "مقاس كبير",
  sale_price: "88.00",
  min_order_qty: 3,
  qty_increment: 3,
  stock_quantity: 4,
  sort_order: 1,
};

const earlyPayloadOf = (button: HTMLElement) =>
  JSON.parse(button.getAttribute("data-early-add") ?? "null");

describe("AddToCartForm — الإضافة قبل وصول React", () => {
  test("الزرّ يحمل الحمولة في HTML نفسه، بالكمية الدنيا", () => {
    renderForm();
    const payload = earlyPayloadOf(screen.getByRole("button", { name: "أضف إلى السلة" }));

    expect(payload).toEqual({
      productId: 1,
      variantId: null,
      slug: "test-product",
      sku: "TF-TEST-001",
      name: "منتج اختبار",
      variantName: null,
      unitPrice: 75.5,
      minOrderQty: 2,
      qtyIncrement: 1,
      imageUrl: null,
      quantity: 2,
    });
  });

  // الضمانة الأهم: ما يكتبه الجسر قبل الترطيب هو نفسه ما يكتبه React بعده.
  // لو افترقا لتغيّرت سلّة الزبون تحت يده لحظة وصول React.
  test("الحمولة مطابقة تماماً لِما يضعه React في السلة عند نفس الضغطة", async () => {
    renderForm();
    const button = screen.getByRole("button", { name: "أضف إلى السلة" });
    const payload = earlyPayloadOf(button);

    fireEvent.click(button);

    await waitFor(() => {
      const cart = JSON.parse(window.localStorage.getItem("tayssir_cart_v1") ?? "[]");
      expect(cart).toEqual([payload]);
    });
  });

  // اختيار المقاس نفسه يحتاج React. إضافة أوّل مقاس نيابةً عن الزبون قد
  // تضع في سلّته ما لم يخترْه — فالجسر يمتنع هنا عمداً.
  test("منتج له مقاسات: لا حمولة مبكّرة إطلاقاً", () => {
    render(
      <CartProvider>
        <AddToCartForm product={PRODUCT} variants={[VARIANT]} imageUrl={null} />
      </CartProvider>
    );

    expect(
      screen.getByRole("button", { name: "أضف إلى السلة" }).hasAttribute("data-early-add")
    ).toBe(false);
  });

  test("منتج نافد: لا زرّ إضافة ولا حمولة", () => {
    render(
      <CartProvider>
        <AddToCartForm product={{ ...PRODUCT, stock_quantity: 0 }} variants={[]} imageUrl={null} />
      </CartProvider>
    );

    expect(screen.queryByRole("button", { name: "أضف إلى السلة" })).toBeNull();
    expect(document.querySelector("[data-early-add]")).toBeNull();
  });

  // الكمية الدنيا قيدٌ لم يُمسّ: الحمولة تبدأ منها ولا تنزل تحتها أبداً،
  // مهما كانت درجة الزيادة.
  test("الحمولة لا تحمل أبداً كمية أقل من الكمية الدنيا للمنتج", () => {
    render(
      <CartProvider>
        <AddToCartForm
          product={{ ...PRODUCT, min_order_qty: 10, qty_increment: 5 }}
          variants={[]}
          imageUrl={null}
        />
      </CartProvider>
    );

    const payload = earlyPayloadOf(screen.getByRole("button", { name: "أضف إلى السلة" }));
    expect(payload.quantity).toBe(10);
    expect(payload.minOrderQty).toBe(10);
    expect(payload.quantity).toBeGreaterThanOrEqual(payload.minOrderQty);
  });

  test("الزرّ يحمل عنصر النص الذي يبدّله الجسر ليؤكّد للزبون", () => {
    renderForm();
    const label = screen
      .getByRole("button", { name: "أضف إلى السلة" })
      .querySelector("[data-add-label]");

    expect(label?.textContent?.trim()).toBe("أضف إلى السلة");
  });
});
