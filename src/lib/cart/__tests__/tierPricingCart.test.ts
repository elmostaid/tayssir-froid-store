import { describe, expect, it } from "vitest";
import {
  cartItemLineTotal,
  cartItemUnitPrice,
  computeSubtotal,
} from "@/lib/cart/cartMath";
import { resolveLineTotal, toTierPricing } from "@/lib/pricing/tierPricing";
import type { CartItem } from "@/lib/cart/types";

const MONTRI_ROW = {
  sale_price: "20.00",
  pricing_mode: "three_tier",
  tier2_min_qty: 10,
  tier2_price: "13.00",
  tier3_min_qty: 50,
  tier3_price: "12.00",
};

const montriPricing = toTierPricing(MONTRI_ROW);

function montriCartItem(quantity: number): CartItem {
  return {
    productId: 1,
    variantId: null,
    slug: "montri-savon-6-fils",
    sku: "MNT-001",
    name: "منتري صابون 6 خيوط",
    variantName: null,
    unitPrice: montriPricing.unitPrice,
    pricing: montriPricing,
    minOrderQty: 1,
    qtyIncrement: 1,
    imageUrl: null,
    quantity,
  };
}

describe("سلَّة بتسعير متدرِّج", () => {
  it.each([
    [1, 20, 20],
    [9, 20, 180],
    [10, 13, 130],
    [49, 13, 637],
    [50, 12, 600],
    [51, 12, 612],
  ])("كمية %i ⇒ الوحدة %i، السطر %i", (quantity, unit, total) => {
    const item = montriCartItem(quantity);
    expect(cartItemUnitPrice(item)).toBe(unit);
    expect(cartItemLineTotal(item)).toBe(total);
  });

  it("تغيير الكمية 9 → 10 يخفّض الثمن فوراً، و10 → 9 يُرجعه", () => {
    expect(cartItemUnitPrice(montriCartItem(9))).toBe(20);
    expect(cartItemUnitPrice(montriCartItem(10))).toBe(13);
    expect(cartItemUnitPrice(montriCartItem(9))).toBe(20);
  });

  it("تغيير الكمية 49 → 50 ثم الرجوع إلى 49", () => {
    expect(cartItemLineTotal(montriCartItem(49))).toBe(637);
    expect(cartItemLineTotal(montriCartItem(50))).toBe(600);
    expect(cartItemLineTotal(montriCartItem(49))).toBe(637);
  });

  it("مجموع السلَّة يجمع أسطراً بأنماط تسعير مختلفة", () => {
    const singlePriceItem: CartItem = {
      ...montriCartItem(2),
      productId: 2,
      sku: "SNG-001",
      unitPrice: 150,
      pricing: toTierPricing({ sale_price: "150", pricing_mode: "single" }),
    };
    // 50 منتري بـ12 = 600، + قطعتان بـ150 = 300
    expect(computeSubtotal([montriCartItem(50), singlePriceItem])).toBe(900);
  });
});

describe("توافق خلفي: سلَّة قديمة محفوظة في localStorage", () => {
  // عنصر بالصيغة القديمة تماماً — بلا حقل pricing إطلاقاً، كما كان يُحفَظ
  // قبل نشر هذه الميزة. يجب ألا ينكسر ولا يتغيّر ثمنه.
  const legacyItem = {
    productId: 7,
    variantId: null,
    slug: "vieux-produit",
    sku: "OLD-001",
    name: "منتج قديم",
    variantName: null,
    unitPrice: 45.5,
    minOrderQty: 5,
    qtyIncrement: 5,
    imageUrl: null,
    quantity: 10,
  } as CartItem;

  it("يستعمل ثمنه المخزَّن كما هو", () => {
    expect(cartItemUnitPrice(legacyItem)).toBe(45.5);
    expect(cartItemLineTotal(legacyItem)).toBe(455);
  });

  it("لا يتأثر بأي عتبة كمية (يبقى ثمناً واحداً)", () => {
    expect(cartItemUnitPrice({ ...legacyItem, quantity: 100 })).toBe(45.5);
    expect(cartItemLineTotal({ ...legacyItem, quantity: 100 })).toBe(4550);
  });

  it("يُجمَع بشكل صحيح مع عنصر جديد بتسعير متدرِّج في نفس السلَّة", () => {
    // 455 (قديم) + 130 (منتري ×10 بـ13) = 585
    expect(computeSubtotal([legacyItem, montriCartItem(10)])).toBe(585);
  });

  it("عنصر قديم يمر عبر JSON.parse (كما يقرأه CartProvider فعلياً) يبقى سليماً", () => {
    const roundTripped = JSON.parse(JSON.stringify(legacyItem)) as CartItem;
    expect(roundTripped.pricing).toBeUndefined();
    expect(cartItemLineTotal(roundTripped)).toBe(455);
  });
});

describe("اتساق الحساب بين السلَّة والخادم", () => {
  // createOrder يستعمل resolveLineTotal مباشرة على سلَّم الأثمنة المُعاد
  // جلبه من قاعدة البيانات. هذا الاختبار يثبّت أن الطريقين يعطيان نفس
  // الرقم لكل الكميات الحدّية المطلوبة.
  it.each([1, 9, 10, 49, 50, 51])(
    "كمية %i: السلَّة والخادم يعطيان نفس المجموع",
    (quantity) => {
      const cartTotal = cartItemLineTotal(montriCartItem(quantity));
      const serverTotal = resolveLineTotal(toTierPricing(MONTRI_ROW), quantity);
      expect(cartTotal).toBe(serverTotal);
    }
  );

  it("سلَّم أثمنة تالف في السلَّة لا يمنح الزبون ثمناً أرخص من الخادم", () => {
    // محاولة تلاعب: زبون يعدّل localStorage ليضع ثمناً وهمياً منخفضاً.
    // العرض في السلَّة قد يتأثر، لكن الخادم يعيد الحساب من قاعدة البيانات
    // ولا يقرأ أي ثمن من المتصفح إطلاقاً.
    const tampered = montriCartItem(1);
    tampered.pricing = toTierPricing({ sale_price: "1", pricing_mode: "single" });
    expect(cartItemUnitPrice(tampered)).toBe(1);

    const serverPrice = resolveLineTotal(toTierPricing(MONTRI_ROW), 1);
    expect(serverPrice).toBe(20);
  });
});
