import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  trackGaViewItem,
  trackGaAddToCart,
  trackGaBeginCheckout,
  trackGaPurchase,
  __resetGaQueueForTests,
} from "@/lib/ga/ecommerce";

function mockGtag() {
  const fn = vi.fn();
  window.gtag = fn;
  return fn;
}

beforeEach(() => {
  __resetGaQueueForTests();
  delete (window as { gtag?: unknown }).gtag;
  delete (window as { dataLayer?: unknown }).dataLayer;
});

afterEach(() => {
  __resetGaQueueForTests();
  vi.useRealTimers();
});

describe("GA4 ecommerce — أحداث فقط، بالقيم والمنتجات الصحيحة، بلا page_view", () => {
  test("لا يرمي ولا يفعل شيئاً إذا لم يُحمَّل gtag بعد (حاجب إعلانات مثلاً)", () => {
    expect(() => trackGaViewItem({ sku: "TF-1", name: "منتج", price: 12 })).not.toThrow();
    expect(window.gtag).toBeUndefined();
  });

  test("view_item: القيمة هي ثمن الوحدة، والمنتج بـitem_id/item_name/price/quantity", () => {
    const gtag = mockGtag();
    trackGaViewItem({ sku: "TF-COMP-01", name: "ضاغط", price: 450, category: "ضواغط" });

    expect(gtag).toHaveBeenCalledTimes(1);
    const [call, name, params] = gtag.mock.calls[0];
    expect(call).toBe("event");
    expect(name).toBe("view_item");
    expect(params).toEqual({
      currency: "MAD",
      value: 450,
      items: [
        {
          item_id: "TF-COMP-01",
          item_name: "ضاغط",
          price: 450,
          quantity: 1,
          item_category: "ضواغط",
        },
      ],
    });
  });

  test("add_to_cart: القيمة = ثمن الوحدة × الكمية، لا ثمن الوحدة وحده", () => {
    const gtag = mockGtag();
    trackGaAddToCart({ sku: "TF-2", name: "منظّم", price: 30, quantity: 50 });

    const [, name, params] = gtag.mock.calls[0];
    expect(name).toBe("add_to_cart");
    expect(params.value).toBe(1500);
    expect(params.currency).toBe("MAD");
    expect(params.items).toEqual([
      { item_id: "TF-2", item_name: "منظّم", price: 30, quantity: 50 },
    ]);
  });

  test("begin_checkout: كل سطور السلة ومجموعها، وitem_variant حين يوجد مقاس", () => {
    const gtag = mockGtag();
    trackGaBeginCheckout({
      items: [
        { sku: "A", name: "أ", price: 10, quantity: 2, variant: "كبير" },
        { sku: "B", name: "ب", price: 5, quantity: 4 },
      ],
      value: 40,
    });

    const [, name, params] = gtag.mock.calls[0];
    expect(name).toBe("begin_checkout");
    expect(params.value).toBe(40);
    expect(params.items).toEqual([
      { item_id: "A", item_name: "أ", price: 10, quantity: 2, item_variant: "كبير" },
      { item_id: "B", item_name: "ب", price: 5, quantity: 4 },
    ]);
  });

  test("begin_checkout بلا value مُمرَّرة: يحسب المجموع من السطور نفسها", () => {
    const gtag = mockGtag();
    trackGaBeginCheckout({
      items: [
        { sku: "A", name: "أ", price: 10, quantity: 2 },
        { sku: "B", name: "ب", price: 5, quantity: 4 },
      ],
    });
    expect(gtag.mock.calls[0][2].value).toBe(40);
  });

  test("purchase: transaction_id ومجموع وعملة MAD وكل المنتجات", () => {
    const gtag = mockGtag();
    trackGaPurchase({
      transactionId: "TF-2026-0042",
      items: [{ sku: "A", name: "أ", price: 100, quantity: 3 }],
      value: 300,
    });

    const [, name, params] = gtag.mock.calls[0];
    expect(name).toBe("purchase");
    expect(params).toEqual({
      transaction_id: "TF-2026-0042",
      currency: "MAD",
      value: 300,
      items: [{ item_id: "A", item_name: "أ", price: 100, quantity: 3 }],
    });
  });

  test("لا يُرسَل أبداً config ولا js — أي page_view ثانٍ مستحيل من هذه الطبقة", () => {
    const gtag = mockGtag();
    trackGaViewItem({ sku: "A", name: "أ", price: 1 });
    trackGaAddToCart({ sku: "A", name: "أ", price: 1, quantity: 1 });
    trackGaBeginCheckout({ items: [{ sku: "A", name: "أ", price: 1, quantity: 1 }] });
    trackGaPurchase({ transactionId: "T1", items: [{ sku: "A", name: "أ", price: 1, quantity: 1 }] });

    expect(gtag.mock.calls).toHaveLength(4);
    for (const call of gtag.mock.calls) {
      expect(call[0]).toBe("event");
      expect(call[1]).not.toBe("page_view");
    }
  });

  test("حدث وقع قبل تعريف gtag يُرسَل بعد ظهوره، بالترتيب الصحيح", () => {
    vi.useFakeTimers();
    trackGaViewItem({ sku: "A", name: "أ", price: 1 });
    trackGaAddToCart({ sku: "A", name: "أ", price: 1, quantity: 2 });

    const gtag = mockGtag();
    vi.advanceTimersByTime(250);

    expect(gtag.mock.calls.map((c) => c[1])).toEqual(["view_item", "add_to_cart"]);
  });

  test("إذا لم يظهر gtag أبداً: يُسقَط الطابور بعد المهلة بلا تسريب ولا استثناء", () => {
    vi.useFakeTimers();
    trackGaViewItem({ sku: "A", name: "أ", price: 1 });

    expect(() => vi.advanceTimersByTime(11_000)).not.toThrow();

    // ظهر متأخراً جداً — لا شيء يُرسَل، ولا مؤقّت باقٍ يدور إلى الأبد.
    const gtag = mockGtag();
    vi.advanceTimersByTime(5_000);
    expect(gtag).not.toHaveBeenCalled();
  });
});
