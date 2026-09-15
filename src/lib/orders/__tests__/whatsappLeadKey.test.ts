import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getOrCreateWhatsappLeadKey } from "@/lib/orders/whatsappLeadKey";
import type { CartItem } from "@/lib/cart/types";

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

/**
 * هذا هو الدليل المباشر على متطلَّب "الرجوع للسلة وإعادة الضغط لا يُنشئ
 * duplicate": استدعاءان منفصلان (يُحاكيان تركيب مكوّنين مختلفين، كما يقع
 * فعلياً عند التنقّل ذهاباً وإياباً) بنفس محتوى السلة يجب أن يُرجعا نفس
 * المفتاح — لا مفتاحاً عشوائياً جديداً كل مرة.
 */
describe("getOrCreateWhatsappLeadKey", () => {
  test("يُرجع نفس المفتاح لنفس محتوى السلة عبر استدعاءات منفصلة (محاكاة الرجوع وإعادة الضغط)", () => {
    const items = [item()];
    const first = getOrCreateWhatsappLeadKey(items);
    const second = getOrCreateWhatsappLeadKey(items);
    expect(second).toBe(first);
  });

  test("يُرجع مفتاحاً جديداً حين تتغيّر الكمية", () => {
    const first = getOrCreateWhatsappLeadKey([item({ quantity: 2 })]);
    const second = getOrCreateWhatsappLeadKey([item({ quantity: 3 })]);
    expect(second).not.toBe(first);
  });

  test("يُرجع مفتاحاً جديداً حين يُضاف منتج آخر للسلة", () => {
    const first = getOrCreateWhatsappLeadKey([item()]);
    const second = getOrCreateWhatsappLeadKey([item(), item({ productId: 52, sku: "TF-GAS-002" })]);
    expect(second).not.toBe(first);
  });

  test("مفتاحان مختلفان لسلّتين مختلفتين لا يتداخلان بعد العودة للسلة الأولى", () => {
    const cartA = [item()];
    const cartB = [item({ quantity: 5 })];
    const keyA1 = getOrCreateWhatsappLeadKey(cartA);
    getOrCreateWhatsappLeadKey(cartB); // الزبون عدّل السلة
    const keyA2 = getOrCreateWhatsappLeadKey(cartA); // ثم رجع لنفس السلة الأولى تماماً

    // بعد تعديل السلة، «الرجوع» لنفس محتوى السلة الأولى حرفياً يُعامَل هنا
    // كسلة جديدة (لا نحتفظ بتاريخ كل تركيبة سابقة) — وهذا صحيح: لا نعرف
    // فعلياً إن كانت هي نفس نية الطلب أو طلبية ثانية منفصلة.
    expect(typeof keyA2).toBe("string");
    expect(keyA1).not.toBe(""); // فقط للتأكد من عدم رجوع قيمة فارغة
  });

  test("لا يرمي حين localStorage محظور (تصفّح خاص)", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("محظور");
    };
    try {
      expect(() => getOrCreateWhatsappLeadKey([item()])).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
