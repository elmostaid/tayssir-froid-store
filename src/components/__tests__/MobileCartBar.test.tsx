import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import { MobileCartBar } from "@/components/MobileCartBar";

// المسار الحالي هو المتغيّر الوحيد الذي يهمّنا هنا، فنتحكّم فيه مباشرة.
const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

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
  quantity: 2,
};

beforeEach(() => {
  pathname.current = "/";
  window.localStorage.setItem("tayssir_cart_v1", JSON.stringify([CART_ITEM]));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderBar() {
  return render(
    <CartProvider>
      <MobileCartBar />
    </CartProvider>
  );
}

describe("MobileCartBar", () => {
  test("يظهر بقيمة السلة وزرّ يقود إلى إتمام الطلب في صفحات التصفّح", async () => {
    renderBar();

    const cta = await screen.findByRole("link", { name: "إتمام الطلب" });
    expect(cta.getAttribute("href")).toBe("/checkout");
    await waitFor(() => expect(screen.getByText("200,00 درهم")).toBeTruthy());
  });

  // العطل الذي يحرسه هذا الاختبار: زرّ برتقالي كبير أسفل صفحة إتمام الطلب
  // يقود إلى نفس الصفحة. الزبون وهو يعمّر النموذج يراه فيظنّه زرّ الإنهاء،
  // فيضغطه وتُعاد الصفحة ويضيع كل ما كتبه. لا يكفي إخفاؤه بـCSS: السكريبت
  // المبكّر يُظهر [data-cart-bar] بنفسه، فالمطلوب ألّا يوجد في الصفحة أصلاً.
  test("لا يظهر إطلاقاً في صفحة إتمام الطلب — ولا حتى في الـDOM", async () => {
    pathname.current = "/checkout";
    const { container } = renderBar();

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "إتمام الطلب" })).toBeNull()
    );
    expect(container.querySelector("[data-cart-bar]")).toBeNull();
  });

  test("يبقى مخفيّاً ما دامت السلة فارغة", async () => {
    window.localStorage.setItem("tayssir_cart_v1", "[]");
    const { container } = renderBar();

    await waitFor(() => {
      const bar = container.querySelector("[data-cart-bar]");
      expect(bar).not.toBeNull();
      expect(bar?.hasAttribute("hidden")).toBe(true);
    });
  });
});
