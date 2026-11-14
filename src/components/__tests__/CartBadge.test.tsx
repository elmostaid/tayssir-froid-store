import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import { CartBadge } from "@/components/CartBadge";

const CART_ITEM = {
  productId: 51,
  variantId: null,
  slug: "door-lock",
  sku: "TF-AWM-005",
  name: "قفل باب",
  variantName: null,
  unitPrice: 100,
  minOrderQty: 1,
  qtyIncrement: 1,
  imageUrl: null,
  quantity: 3,
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderBadge() {
  return render(
    <CartProvider>
      <CartBadge />
    </CartProvider>
  );
}

describe("CartBadge", () => {
  test("يقود إلى السلة ويقول وظيفتها: الدخول لإتمام الطلب", () => {
    const { container } = renderBadge();

    const link = container.querySelector('a[href="/cart"]');
    expect(link).not.toBeNull();
    // النصّان معاً في الـDOM (أحدهما يظهر حسب عرض الشاشة عبر CSS): نصّ
    // الهاتف المختصر، ونصّ الحاسوب الكامل كما طُلب حرفياً.
    expect(link?.textContent).toContain("السلة");
    expect(link?.textContent).toContain("لإتمام الطلب");
    expect(link?.textContent).toContain("الدخول للسلة لإتمام الطلب");
  });

  // العطل الذي يحرسه: السكريبت المبكّر (lib/cart/earlyAdd.ts) يكتب العدد في
  // [data-cart-count] مباشرة قبل وصول React. فلو اختفى هذا المُعرِّف أو صار
  // العنصر يُركَّب عند أول إضافة فقط، لبقي العدّاد صفراً أمام الزبون الذي
  // ضغط «أضف للسلة» قبل الترطيب — وهو أبطأ ما في الصفحة على 4G.
  test("عنصر العدّاد موجود دائماً بنفس المُعرِّف الذي يكتب فيه السكريبت المبكّر", async () => {
    const { container } = renderBadge();

    const counter = container.querySelector("[data-cart-count]");
    expect(counter).not.toBeNull();
    expect(counter?.hasAttribute("hidden")).toBe(true);

    cleanup();
    window.localStorage.setItem("tayssir_cart_v1", JSON.stringify([CART_ITEM]));
    const second = renderBadge();

    await waitFor(() => {
      const el = second.container.querySelector("[data-cart-count]");
      expect(el?.hasAttribute("hidden")).toBe(false);
      expect(el?.textContent).toBe("3");
    });
  });

  test("الاسم المقروء يحمل العدد ووظيفة الزرّ معاً", async () => {
    window.localStorage.setItem("tayssir_cart_v1", JSON.stringify([CART_ITEM]));
    renderBadge();

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "الدخول للسلة لإتمام الطلب — 3 قطعة" })
      ).toBeTruthy()
    );
  });
});
