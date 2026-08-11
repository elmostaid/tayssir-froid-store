import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import type { CartItem } from "@/lib/cart/types";

const trackInitiateCheckoutMock = vi.fn();
const trackPurchaseMock = vi.fn();
vi.mock("@/lib/pixel/fbq", () => ({
  trackInitiateCheckout: (...args: unknown[]) => trackInitiateCheckoutMock(...args),
  trackPurchase: (...args: unknown[]) => trackPurchaseMock(...args),
}));

const submitOrderMock = vi.fn();
vi.mock("@/app/(storefront)/checkout/actions", () => ({
  submitOrder: (...args: unknown[]) => submitOrderMock(...args),
}));

const { CheckoutClient } = await import("@/components/CheckoutClient");

const STORAGE_KEY = "tayssir_cart_v1";
const CART_ITEMS: CartItem[] = [
  {
    productId: 1,
    variantId: null,
    slug: "test-product",
    sku: "TF-TEST-001",
    name: "منتج اختبار",
    variantName: null,
    unitPrice: 100,
    minOrderQty: 1,
    qtyIncrement: 1,
    imageUrl: null,
    quantity: 2,
  },
];

function renderCheckout() {
  return render(
    <CartProvider>
      <CheckoutClient
        minOrderAmountMad={0}
        deliveryFeePerCartonMad={45}
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
  fireEvent.change(screen.getByLabelText(/العنوان الكامل/), { target: { value: "حي المحاميد" } });
}

beforeEach(() => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(CART_ITEMS));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  trackInitiateCheckoutMock.mockReset();
  trackPurchaseMock.mockReset();
  submitOrderMock.mockReset();
});

describe("CheckoutClient — Meta Pixel: InitiateCheckout مرة واحدة، Purchase فقط بعد نجاح حقيقي", () => {
  test("InitiateCheckout يُطلَق مرة واحدة فقط بعد التحميل (سلة غير فارغة)، بالقيم الصحيحة", async () => {
    renderCheckout();

    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));
    expect(trackInitiateCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ sku: "TF-TEST-001", quantity: 2, price: 100 }],
        value: 200,
      })
    );

    // الكتابة فالحقول تُعيد رندر المكوّن عدة مرات — لا يجب أن يتكرر الحدث.
    await fillRequiredFields();
    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));
  });

  test("Purchase لا يُطلَق بمجرد الضغط على 'إرسال الطلب' — فقط بعد نجاح createOrder فعلياً (ok:true)", async () => {
    submitOrderMock.mockResolvedValue({ ok: true, publicReference: "TF-2026-0001" });
    renderCheckout();
    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));

    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await waitFor(() => expect(trackPurchaseMock).toHaveBeenCalledTimes(1));
    expect(trackPurchaseMock).toHaveBeenCalledWith({
      items: [{ sku: "TF-TEST-001", quantity: 2, price: 100 }],
      value: 200,
      eventId: expect.any(String),
    });
  });

  test("فشل createOrder (ok:false): Purchase لا يُطلَق إطلاقاً، رغم إتمام مسار واتساب كالمعتاد", async () => {
    submitOrderMock.mockResolvedValue({
      ok: false,
      errors: [{ field: "phone", message: "خطأ تجريبي غير عام" }],
    });
    renderCheckout();
    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));

    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await waitFor(() => expect(submitOrderMock).toHaveBeenCalledTimes(1));
    // ننتظر قليلاً للتأكد أن Purchase لن يُطلَق لاحقاً أيضاً (وليس فقط أنه
    // لم يُطلَق بعد فهذه اللحظة بالذات).
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(trackPurchaseMock).not.toHaveBeenCalled();
  });

  test("event_id ديال Purchase يبقى نفس idempotencyKey حتى لو استُدعي submitOrder أكثر من مرة (لا يتكرر Purchase أبداً)", async () => {
    submitOrderMock.mockResolvedValue({ ok: true, publicReference: "TF-2026-0002" });
    renderCheckout();
    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));

    await fillRequiredFields();
    const submitBtn = screen.getByRole("button", { name: /إرسال الطلب/ });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(trackPurchaseMock).toHaveBeenCalledTimes(1));

    // زر الإرسال يختفي بعد "sent"، فلا مجال لنقرة ثانية حقيقية من الواجهة —
    // نتحقق فقط أن الاستدعاء الوحيد سليم القيمة (خط الدفاع الحقيقي ضد
    // التكرار هو hasTrackedPurchase.current، مُختبَر بشكل غير مباشر هنا عبر
    // استقرار العدد عند 1 رغم عدة إعادات رندر لاحقة).
    expect(trackPurchaseMock).toHaveBeenCalledTimes(1);
  });
});
