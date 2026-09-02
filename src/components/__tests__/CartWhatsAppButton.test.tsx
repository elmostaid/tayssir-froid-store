import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import { CartWhatsAppButton } from "@/components/CartWhatsAppButton";

// buildWhatsAppLink يُرمّز المسافات كـ"+" (صيغة application/x-www-form-urlencoded
// التي يفهمها واتساب)، وdecodeURIComponent وحده لا يعكسها.
function messageOf(link: Element): string {
  return decodeURIComponent(link.getAttribute("href") ?? "").replace(/\+/g, " ");
}

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/track", () => ({ trackAnalyticsEvent: track }));

const attribution = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/attribution/capture", () => ({
  getOrderAttribution: () => attribution.current,
}));

const CART_ITEM = {
  productId: 51,
  variantId: null,
  slug: "gas-r410",
  sku: "TF-GAS-001",
  name: "غاز تبريد R410A",
  variantName: null,
  unitPrice: 1200,
  minOrderQty: 1,
  qtyIncrement: 1,
  imageUrl: null,
  quantity: 2,
};

beforeEach(() => {
  track.mockClear();
  attribution.current = null;
  window.localStorage.setItem("tayssir_cart_v1", JSON.stringify([CART_ITEM]));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderButton() {
  return render(
    <CartProvider>
      <CartWhatsAppButton whatsappNumber="+212722083458" storeName="Tayssir Froid" />
    </CartProvider>
  );
}

/**
 * الطريق الثاني إلى الطلب — بلا نموذج.
 *
 * ما يهمّ هنا ثلاثة أشياء لا رابعة: أن يحمل الرابط الطلبية فعلاً (لا رسالة
 * فارغة يكتبها الزبون بنفسه)، وأن يُسجَّل الضغط حدثاً مستقلاً (بدونه لا
 * نعرف هل أضاف هذا المسار طلبات أم سحبها من النموذج)، وألّا يظهر الزر
 * أصلاً حين لا توجد سلة.
 */
describe("CartWhatsAppButton", () => {
  test("يبني رابط واتساب من محتوى السلة", async () => {
    renderButton();

    const link = await screen.findByRole("link", { name: /أكمل الطلب عبر واتساب/ });
    const href = messageOf(link);

    expect(href).toContain("api.whatsapp.com/send");
    expect(href).toContain("212722083458");
    expect(href).toContain("غاز تبريد R410A");
    expect(href).toContain("× 2");
    expect(href).toMatch(/المرجع: W-[0-9A-F]{8}/);
  });

  test("يُسجّل whatsapp_from_cart بقيمة السلة عند الضغط", async () => {
    renderButton();

    const link = await screen.findByRole("link", { name: /أكمل الطلب عبر واتساب/ });
    link.click();

    expect(track).toHaveBeenCalledWith("whatsapp_from_cart", { cartValue: 2400 });
  });

  test("يكتب المصدر في الرسالة حين تكون النسبة معروفة", async () => {
    attribution.current = {
      last: { utmSource: "facebook", utmMedium: "cpc", referrerHost: "facebook.com" },
    };
    renderButton();

    const link = await screen.findByRole("link", { name: /أكمل الطلب عبر واتساب/ });
    const href = messageOf(link);

    expect(href).toContain("المصدر: facebook / cpc");
  });

  test("لا يحمل مُعرّف النقرة إلى المحادثة", async () => {
    attribution.current = {
      last: { utmSource: "facebook", utmMedium: "cpc", clickId: "fb.1.xyz", referrerHost: "facebook.com" },
    };
    renderButton();

    const link = await screen.findByRole("link", { name: /أكمل الطلب عبر واتساب/ });
    const href = messageOf(link);

    expect(href).not.toContain("fb.1.xyz");
  });

  test("لا يظهر إطلاقاً حين تكون السلة فارغة", async () => {
    window.localStorage.clear();
    renderButton();

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /واتساب/ })).toBeNull();
    });
  });
});
