import { describe, expect, test } from "vitest";
import {
  cartItemKey,
  computeSubtotal,
  isValidQuantity,
  snapQuantity,
} from "@/lib/cart/cartMath";
import type { CartItem } from "@/lib/cart/types";

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: 1,
    variantId: null,
    slug: "demo",
    sku: "DEMO-001",
    name: "منتج تجريبي",
    variantName: null,
    unitPrice: 18,
    minOrderQty: 5,
    qtyIncrement: 5,
    imageUrl: null,
    quantity: 5,
    ...overrides,
  };
}

describe("cartItemKey", () => {
  test("يميّز بين نفس المنتج بمتغيرات مختلفة", () => {
    expect(cartItemKey(1, null)).toBe("1:base");
    expect(cartItemKey(1, 2)).not.toBe(cartItemKey(1, 3));
  });
});

describe("computeSubtotal", () => {
  test("يجمع سعر كل سطر × الكمية عبر منتجات مختلطة", () => {
    const items = [
      makeItem({ unitPrice: 18, quantity: 5 }),
      makeItem({ productId: 2, unitPrice: 25, quantity: 10 }),
    ];
    expect(computeSubtotal(items)).toBe(18 * 5 + 25 * 10);
  });

  test("سلة فارغة = صفر", () => {
    expect(computeSubtotal([])).toBe(0);
  });
});

describe("snapQuantity", () => {
  test("لا يقل أبداً عن الكمية الدنيا", () => {
    expect(snapQuantity(1, 5, 5)).toBe(5);
    expect(snapQuantity(0, 5, 5)).toBe(5);
  });

  test("يقرّب لأقرب مضاعف صحيح فوق الكمية الدنيا", () => {
    expect(snapQuantity(12, 5, 5)).toBe(10);
    expect(snapQuantity(13, 5, 5)).toBe(15);
  });

  test("يحترم درجة زيادة مختلفة عن 1", () => {
    expect(snapQuantity(22, 10, 10)).toBe(20);
  });
});

describe("isValidQuantity", () => {
  test("يرفض كمية أقل من الحد الأدنى", () => {
    expect(isValidQuantity(3, 5, 5)).toBe(false);
  });
  test("يرفض كمية ليست مضاعفاً صحيحاً لدرجة الزيادة", () => {
    expect(isValidQuantity(7, 5, 5)).toBe(false);
  });
  test("يقبل الكمية الدنيا نفسها ومضاعفاتها", () => {
    expect(isValidQuantity(5, 5, 5)).toBe(true);
    expect(isValidQuantity(15, 5, 5)).toBe(true);
  });
});
