import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import type { CartItem } from "@/lib/cart/types";

// Meta والقياس الداخلي مُعطَّلان هنا عمداً: هذا الملف يختبر مسار GA4 وحده،
// وتعطيلهما يُثبت أيضاً أن GA4 لا يعتمد على أيٍّ منهما.
vi.mock("@/lib/pixel/fbq", () => ({
  trackInitiateCheckout: vi.fn(),
  trackPurchase: vi.fn(),
}));
vi.mock("@/lib/analytics/track", () => ({ trackAnalyticsEvent: vi.fn() }));

const beginCheckoutMock = vi.fn();
const purchaseMock = vi.fn();
vi.mock("@/lib/ga/ecommerce", () => ({
  trackGaBeginCheckout: (...args: unknown[]) => beginCheckoutMock(...args),
  trackGaPurchase: (...args: unknown[]) => purchaseMock(...args),
}));

const submitOrderMock = vi.fn();
vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
  if (String(url).includes("/api/orders")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(submitOrderMock(JSON.parse(String(init?.body ?? "{}")))),
    } as Response);
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
});

const { CheckoutClient } = await import("@/components/CheckoutClient");

const STORAGE_KEY = "tayssir_cart_v1";
const CART_ITEMS: CartItem[] = [
  {
    productId: 1,
    variantId: null,
    slug: "compresseur",
    sku: "TF-COMP-01",
    name: "ضاغط",
    variantName: null,
    unitPrice: 100,
    minOrderQty: 1,
    qtyIncrement: 1,
    imageUrl: null,
    quantity: 2,
  },
  {
    productId: 2,
    variantId: 7,
    slug: "joint",
    sku: "TF-JOINT-02",
    name: "جوان",
    variantName: "كبير",
    unitPrice: 25,
    minOrderQty: 1,
    qtyIncrement: 1,
    imageUrl: null,
    quantity: 4,
  },
];
// 100×2 + 25×4 = 300
const CART_TOTAL = 300;

function renderCheckout() {
  return render(
    <CartProvider>
      <CheckoutClient
        deliveryFeePerCartonMad={30}
        whatsappNumber="+212600000000"
        storeName="Tayssir Froid"
        codEnabled={true}
      />
    </CartProvider>
  );
}

async function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/الاسم الكامل/), { target: { value: "أحمد" } });
  fireEvent.change(screen.getByLabelText(/رقم الهاتف/), { target: { value: "0612345678" } });
  fireEvent.change(screen.getByLabelText(/المدينة/), { target: { value: "مراكش" } });
}

beforeEach(() => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(CART_ITEMS));
  submitOrderMock.mockReturnValue({
    ok: true,
    publicReference: "TF-REF-9",
    orderNumber: "TF-2026-0099",
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  beginCheckoutMock.mockReset();
  purchaseMock.mockReset();
  submitOrderMock.mockReset();
});

describe("GA4 begin_checkout — مرة واحدة، بكل سطور السلة والقيمة الصحيحة", () => {
  test("يُطلَق مرة واحدة بعد الترطيب، ولا يتكرر مع إعادة الرندر", async () => {
    renderCheckout();
    await waitFor(() => expect(beginCheckoutMock).toHaveBeenCalledTimes(1));

    expect(beginCheckoutMock).toHaveBeenCalledWith({
      value: CART_TOTAL,
      items: [
        { sku: "TF-COMP-01", name: "ضاغط", price: 100, quantity: 2, variant: null },
        { sku: "TF-JOINT-02", name: "جوان", price: 25, quantity: 4, variant: "كبير" },
      ],
    });

    await fillRequiredFields();
    await waitFor(() => expect(beginCheckoutMock).toHaveBeenCalledTimes(1));
  });
});

describe("GA4 purchase — على طلب محفوظ حقيقي فقط، مرة واحدة لكل طلب", () => {
  test("نجاح الحفظ: purchase مرة واحدة، transaction_id هو مرجع الطلب الحقيقي", async () => {
    renderCheckout();
    await waitFor(() => expect(beginCheckoutMock).toHaveBeenCalledTimes(1));
    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await waitFor(() => expect(purchaseMock).toHaveBeenCalledTimes(1));
    expect(purchaseMock).toHaveBeenCalledWith({
      transactionId: "TF-REF-9",
      value: CART_TOTAL,
      items: [
        { sku: "TF-COMP-01", name: "ضاغط", price: 100, quantity: 2, variant: null },
        { sku: "TF-JOINT-02", name: "جوان", price: 25, quantity: 4, variant: "كبير" },
      ],
    });
  });

  test("فشل الحفظ (ok:false): لا purchase إطلاقاً", async () => {
    submitOrderMock.mockReturnValue({
      ok: false,
      errors: [{ field: "phone", message: "خطأ تجريبي" }],
    });
    renderCheckout();
    await waitFor(() => expect(beginCheckoutMock).toHaveBeenCalledTimes(1));
    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await waitFor(() => expect(submitOrderMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(purchaseMock).not.toHaveBeenCalled();
  });

  test("طلب ينتظر مراجعة مخزون (needsReview): لا purchase — ليس بيعاً مكتملاً", async () => {
    submitOrderMock.mockReturnValue({
      ok: true,
      publicReference: "TF-REF-REVIEW",
      orderNumber: "TF-2026-0100",
      needsReview: true,
    });
    renderCheckout();
    await waitFor(() => expect(beginCheckoutMock).toHaveBeenCalledTimes(1));
    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await waitFor(() => expect(submitOrderMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(purchaseMock).not.toHaveBeenCalled();
  });

  test("حفظ لم يتأكّد قبل الخروج إلى واتساب: المتصفح لا يُرسل — والخادم هو من يتولّاه", async () => {
    submitOrderMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 30000))
    );
    renderCheckout();
    await waitFor(() => expect(beginCheckoutMock).toHaveBeenCalledTimes(1));
    await fillRequiredFields();
    fireEvent.submit(screen.getByRole("button", { name: /إرسال الطلب/ }).closest("form")!);

    await screen.findByText("تم فتح واتساب لإرسال طلبك", undefined, { timeout: 10000 });
    // المتصفح صامت هنا لأنه لا يعرف مرجع الطلب أصلاً. هذا كان يعني ضياع
    // الشراء نهائياً؛ صار يعني فقط أن الخادم هو صاحب التسجيل — وهو ما
    // يختبره durablePurchase.test.ts على قاعدة حقيقية.
    expect(purchaseMock).not.toHaveBeenCalled();
  }, 20000);
});

describe("لا شراء مضاعف: الخادم والمتصفح لا يُرسلان معاً أبداً", () => {
  test("أرسل الخادم (gaPurchaseHandledServerSide) ⇒ المتصفح يسكت", async () => {
    submitOrderMock.mockReturnValue({
      ok: true,
      publicReference: "TF-REF-SERVER",
      orderNumber: "TF-2026-0101",
      needsReview: false,
      gaPurchaseHandledServerSide: true,
    });
    renderCheckout();
    await waitFor(() => expect(beginCheckoutMock).toHaveBeenCalledTimes(1));
    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await waitFor(() => expect(submitOrderMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 60));
    // GA4 لا تُلغي التكرار حسب transaction_id — إرسال الطرفين يعني طلبين
    // وإيراداً مضاعفاً في التقارير. لذلك الصمت هنا هو الصواب.
    expect(purchaseMock).not.toHaveBeenCalled();
  });

  test("لم يُرسل الخادم ⇒ المتصفح يُرسل مرة واحدة، فلا يضيع الحدث", async () => {
    submitOrderMock.mockReturnValue({
      ok: true,
      publicReference: "TF-REF-CLIENT",
      orderNumber: "TF-2026-0102",
      needsReview: false,
      gaPurchaseHandledServerSide: false,
    });
    renderCheckout();
    await waitFor(() => expect(beginCheckoutMock).toHaveBeenCalledTimes(1));
    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await waitFor(() => expect(purchaseMock).toHaveBeenCalledTimes(1));
    expect(purchaseMock.mock.calls[0][0]).toMatchObject({
      transactionId: "TF-REF-CLIENT",
      value: CART_TOTAL,
    });
  });
});
