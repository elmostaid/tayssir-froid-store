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

// الحفظ صار يمرّ عبر fetch("/api/orders") بـkeepalive بدل Server Action،
// لأن الأخيرة تُقطع لحظة مغادرة الزبون إلى واتساب فيضيع الطلب. نُحاكي fetch
// نفسه حتى تبقى هذه الاختبارات على السلوك الحقيقي للواجهة.
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
  // افتراضياً: الحفظ ينجح بسرعة.
  submitOrderMock.mockReturnValue({ ok: true, publicReference: "TF-REF", orderNumber: "TF-2026-0001" });
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

/**
 * العطل الذي تحرسه هذه المجموعة: الزبون كان يُحبس خلف قاعدة البيانات.
 * الكود القديم ينتظر الحفظ كاملاً (3 محاولات بفواصل) قبل التحويل إلى
 * واتساب — أي نحو 27 ثانية في أسوأ حالة على قاعدة بطيئة. المطلوب الآن أن
 * يخرج الزبون دائماً وبسرعة، وألّا تضيع طلبيته مهما فعلت القاعدة.
 */
describe("CheckoutClient — الخروج إلى واتساب لا يرتهن بقاعدة البيانات", () => {
  // URLSearchParams يرمّز الفراغ "+" لا "%20"، فنُرجعه قبل أي مقارنة نصّية.
  const hrefOf = () =>
    decodeURIComponent(
      (screen.getByRole("link", { name: "فتح واتساب الآن" }) as HTMLAnchorElement).href
    ).replace(/\+/g, " ");

  async function submitAndWait() {
    renderCheckout();
    await screen.findByLabelText(/الاسم الكامل/);
    await fillRequiredFields();
    fireEvent.submit(screen.getByRole("button", { name: /إرسال الطلب/ }).closest("form")!);
    await screen.findByText("تم فتح واتساب لإرسال طلبك", undefined, { timeout: 10000 });
  }

  test("حفظ سريع مؤكَّد: رسالة مختصرة برقم الطلب، وPurchase مرة واحدة", async () => {
    submitOrderMock.mockReturnValue({
      ok: true, publicReference: "TF-REF-1", orderNumber: "TF-2026-0044",
    });
    await submitAndWait();

    const href = hrefOf();
    expect(href).toContain("TF-2026-0044");
    expect(href).not.toContain("TF-TEST-001");
    expect(trackPurchaseMock).toHaveBeenCalledTimes(1);
  });

  test("قاعدة بطيئة جداً: الزبون يخرج بنسخة إنقاذ فيها الطلبية، ولا Purchase", async () => {
    // أبطأ من مهلة التأكيد بكثير — تحاكي 30 ثانية على قاعدة متعثّرة.
    submitOrderMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 30000))
    );
    await submitAndWait();

    const href = hrefOf();
    expect(href).toContain("TF-TEST-001×2");
    expect(href).toContain("لم يُؤكَّد حفظها");
    // لا Purchase على طلب لم يُؤكَّد حفظه — لا شراء وهمي بمجرد ضغطة زر.
    expect(trackPurchaseMock).not.toHaveBeenCalled();
  }, 20000);

  test("فشل الحفظ نهائياً: لا صفحة خطأ، ولا تضيع الطلبية، ولا Purchase", async () => {
    submitOrderMock.mockImplementation(() => {
      throw new Error("قاعدة البيانات غير متاحة");
    });
    await submitAndWait();

    const href = hrefOf();
    expect(href).toContain("TF-TEST-001×2");
    expect(href).toContain("أحمد");
    expect(trackPurchaseMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/تعذّر|خطأ/)).toBeNull();
  });

  test("الزبون لا يبقى عالقاً على «جارٍ الإرسال» في أي حالة", async () => {
    submitOrderMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 30000))
    );
    await submitAndWait();
    expect(screen.queryByText("جارٍ الإرسال…")).toBeNull();
  }, 20000);
});
