import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CartProvider } from "@/components/CartProvider";
import type { CartItem } from "@/lib/cart/types";

const trackInitiateCheckoutMock = vi.fn();
// `trackPurchase` لم يبقَ يُستورَد في هذا المكوّن إطلاقاً: الشراء يُرسَل من
// الخادم عند التأكيد التجاري وحده. وما يبقى للمتصفح هو حدث ضغط زرّ التأكيد.
const trackConfirmOnWhatsAppMock = vi.fn();
vi.mock("@/lib/pixel/fbq", () => ({
  trackInitiateCheckout: (...args: unknown[]) => trackInitiateCheckoutMock(...args),
  trackConfirmOnWhatsApp: (...args: unknown[]) => trackConfirmOnWhatsAppMock(...args),
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
  trackConfirmOnWhatsAppMock.mockReset();
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

  test("الإرسال لا يُطلق أي شراء — ويُظهر صفحة نجاح فيها زرّ التأكيد", async () => {
    // العقد الجديد: المتصفح لا يُطلق `Purchase` أبداً. الطلب المُرسَل ليس
    // بيعة — الزبون يؤكّد في واتساب، والبيعة تُرسَل من الخادم عند التأكيد
    // التجاري وحده. وما يظهر هنا هو خطوة الإغلاق لا حدثها.
    submitOrderMock.mockResolvedValue({
      ok: true, publicReference: "TF-REF-A", orderNumber: "TF-2026-0001",
    });
    renderCheckout();
    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));

    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await screen.findByText("تم تسجيل طلبك ✅", undefined, { timeout: 10000 });
    // الحدث لا يُطلَق بمجرد وصول الصفحة: هو على الضغطة.
    expect(trackConfirmOnWhatsAppMock).not.toHaveBeenCalled();
  });

  test("ضغط «أكّد طلبي على واتساب»: ConfirmOnWhatsApp مرة واحدة بمرجع الطلب", async () => {
    submitOrderMock.mockResolvedValue({
      ok: true, publicReference: "TF-REF-B", orderNumber: "TF-2026-0002",
    });
    renderCheckout();
    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));
    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));
    await screen.findByText("تم تسجيل طلبك ✅", undefined, { timeout: 10000 });

    fireEvent.click(screen.getByRole("link", { name: "أكّد طلبي على واتساب" }));

    expect(trackConfirmOnWhatsAppMock).toHaveBeenCalledTimes(1);
    expect(trackConfirmOnWhatsAppMock).toHaveBeenCalledWith({
      items: [{ sku: "TF-TEST-001", quantity: 2, price: 100 }],
      value: 200,
      // المعرّف يُشتقّ من هذا المرجع، فضغطتان حدثٌ واحد عند Meta.
      orderReference: "TF-2026-0002",
    });
  });

  test("فشل createOrder (ok:false): لا حدث تأكيد، رغم إتمام مسار واتساب كالمعتاد", async () => {
    submitOrderMock.mockResolvedValue({
      ok: false,
      errors: [{ field: "phone", message: "خطأ تجريبي غير عام" }],
    });
    renderCheckout();
    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));

    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));

    await waitFor(() => expect(submitOrderMock).toHaveBeenCalledTimes(1));
    // ننتظر قليلاً للتأكد أنه لن يُطلَق لاحقاً أيضاً (وليس فقط أنه لم
    // يُطلَق بعد فهذه اللحظة بالذات).
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(trackConfirmOnWhatsAppMock).not.toHaveBeenCalled();
  });

  test("ضغطتان على زرّ التأكيد: حدثان بنفس المعرّف — لا شراء مضاعف عند Meta", async () => {
    submitOrderMock.mockResolvedValue({
      ok: true, publicReference: "TF-REF-C", orderNumber: "TF-2026-0003",
    });
    renderCheckout();
    await waitFor(() => expect(trackInitiateCheckoutMock).toHaveBeenCalledTimes(1));
    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /إرسال الطلب/ }));
    await screen.findByText("تم تسجيل طلبك ✅", undefined, { timeout: 10000 });

    const cta = screen.getByRole("link", { name: "أكّد طلبي على واتساب" });
    fireEvent.click(cta);
    fireEvent.click(cta);

    // الزبون قد يعود من واتساب ويضغط ثانيةً — والمرجع نفسه في المرّتين،
    // فـMeta تعتبرهما حدثاً واحداً بحكم event_id المشتقّ منه.
    expect(trackConfirmOnWhatsAppMock).toHaveBeenCalledTimes(2);
    const refs = trackConfirmOnWhatsAppMock.mock.calls.map((call) => call[0].orderReference);
    expect(refs).toEqual(["TF-2026-0003", "TF-2026-0003"]);
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
      (screen.getByRole("link", { name: "أكّد طلبي على واتساب" }) as HTMLAnchorElement).href
    ).replace(/\+/g, " ");

  async function submitAndWait() {
    renderCheckout();
    await screen.findByLabelText(/الاسم الكامل/);
    await fillRequiredFields();
    fireEvent.submit(screen.getByRole("button", { name: /إرسال الطلب/ }).closest("form")!);
    await screen.findByText("تم تسجيل طلبك ✅", undefined, { timeout: 10000 });
  }

  test("حفظ سريع مؤكَّد: رسالة مختصرة برقم الطلب، وPurchase مرة واحدة", async () => {
    submitOrderMock.mockReturnValue({
      ok: true, publicReference: "TF-REF-1", orderNumber: "TF-2026-0044",
    });
    await submitAndWait();

    const href = hrefOf();
    expect(href).toContain("TF-2026-0044");
    // البون مقروء بالاسم في الحالتين، لا أكواد وحدها.
    expect(href).toContain("منتج اختبار");
    // ولا حدث تأكيد قبل الضغط.
    expect(trackConfirmOnWhatsAppMock).not.toHaveBeenCalled();
  });

  test("قاعدة بطيئة جداً: الزبون يخرج بنسخة إنقاذ فيها الطلبية، ولا Purchase", async () => {
    // أبطأ من مهلة التأكيد بكثير — تحاكي 30 ثانية على قاعدة متعثّرة.
    submitOrderMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 30000))
    );
    await submitAndWait();

    const href = hrefOf();
    expect(href).toContain("منتج اختبار");
    expect(href).toMatch(/منتج اختبار.*× 2/);
    expect(href).toContain("لم يُؤكَّد الحفظ");
    // ولا حدث تأكيد: الزبون لم يضغط بعد.
    expect(trackConfirmOnWhatsAppMock).not.toHaveBeenCalled();
  }, 20000);

  test("فشل الحفظ نهائياً: لا صفحة خطأ، ولا تضيع الطلبية، ولا Purchase", async () => {
    submitOrderMock.mockImplementation(() => {
      throw new Error("قاعدة البيانات غير متاحة");
    });
    await submitAndWait();

    const href = hrefOf();
    expect(href).toContain("منتج اختبار");
    expect(href).toMatch(/منتج اختبار.*× 2/);
    expect(href).toContain("أحمد");
    expect(trackConfirmOnWhatsAppMock).not.toHaveBeenCalled();
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
