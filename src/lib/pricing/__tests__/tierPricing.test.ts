import { describe, expect, it } from "vitest";
import {
  describeTiers,
  hasTierPricing,
  resolveLineTotal,
  resolveUnitPrice,
  resolveVariantPricing,
  roundMoney,
  toTierPricing,
  type TierPricing,
} from "@/lib/pricing/tierPricing";

// منتري صابون 6 خيوط — الحالة المرجعية المطلوبة للاختبار على Preview:
// min_order_qty = 1، و 1–9 = 20 / 10–49 = 13 / 50+ = 12
const MONTRI_ROW = {
  sale_price: "20.00",
  pricing_mode: "three_tier",
  tier2_min_qty: 10,
  tier2_price: "13.00",
  tier3_min_qty: 50,
  tier3_price: "12.00",
};

// منتج بثمن واحد بحد أدنى 1 — يجب أن يبقى بثمن واحد مهما كانت الكمية
const SINGLE_ROW = {
  sale_price: "150.00",
  pricing_mode: "single",
  tier2_min_qty: null,
  tier2_price: null,
  tier3_min_qty: null,
  tier3_price: null,
};

describe("toTierPricing", () => {
  it("يبني ثلاثة مستويات من صف قاعدة البيانات", () => {
    expect(toTierPricing(MONTRI_ROW)).toEqual({
      mode: "three_tier",
      unitPrice: 20,
      tier2MinQty: 10,
      tier2Price: 13,
      tier3MinQty: 50,
      tier3Price: 12,
    });
  });

  it("منتج بثمن واحد لا يحمل أي مستويات", () => {
    const pricing = toTierPricing(SINGLE_ROW);
    expect(pricing.mode).toBe("single");
    expect(pricing.unitPrice).toBe(150);
    expect(hasTierPricing(pricing)).toBe(false);
  });

  it("صف قديم بلا أعمدة تسعير إطلاقاً يُعامَل كثمن واحد (توافق خلفي)", () => {
    const pricing = toTierPricing({ sale_price: "45.50" });
    expect(pricing.mode).toBe("single");
    expect(pricing.unitPrice).toBe(45.5);
  });

  it("بيانات متدرِّجة ناقصة تُخفَّض إلى ثمن واحد بدل رمي استثناء", () => {
    const pricing = toTierPricing({
      sale_price: "20",
      pricing_mode: "two_tier",
      tier2_min_qty: null,
      tier2_price: "13",
    });
    expect(pricing.mode).toBe("single");
    expect(pricing.unitPrice).toBe(20);
  });

  it("مستوى ثالث لا يبدأ بعد الثاني يُتجاهَل ويبقى مستويان", () => {
    const pricing = toTierPricing({
      ...MONTRI_ROW,
      tier3_min_qty: 10, // ليس أكبر من tier2_min_qty
    });
    expect(pricing.mode).toBe("two_tier");
    expect(pricing.tier3MinQty).toBeNull();
    expect(resolveUnitPrice(pricing, 100)).toBe(13);
  });
});

describe("resolveUnitPrice — منتري 3 مستويات (1/9/10/49/50/51)", () => {
  const pricing = toTierPricing(MONTRI_ROW);

  it.each([
    [1, 20],
    [9, 20],
    [10, 13],
    [49, 13],
    [50, 12],
    [51, 12],
  ])("كمية %i ⇒ ثمن الوحدة %i درهم", (quantity, expected) => {
    expect(resolveUnitPrice(pricing, quantity)).toBe(expected);
  });

  it.each([
    [1, 20],
    [9, 180],
    [10, 130],
    [49, 637],
    [50, 600],
    [51, 612],
    [60, 720],
  ])("كمية %i ⇒ مجموع السطر %i درهم", (quantity, expected) => {
    expect(resolveLineTotal(pricing, quantity)).toBe(expected);
  });

  it("الثمن الجديد يُطبَّق على كل الوحدات وليس على الزائد فقط", () => {
    // لو كان الحساب تصاعدياً (غير تراجعي) لكان 50 = (49×13)+(1×12) = 649
    expect(resolveLineTotal(pricing, 50)).toBe(600);
    expect(resolveLineTotal(pricing, 50)).not.toBe(649);
  });

  it("الرجوع من 10 إلى 9 يُعيد ثمن المستوى الأول", () => {
    expect(resolveUnitPrice(pricing, 10)).toBe(13);
    expect(resolveUnitPrice(pricing, 9)).toBe(20);
    expect(resolveLineTotal(pricing, 9)).toBe(180);
  });

  it("الرجوع من 50 إلى 49 يُعيد ثمن المستوى الثاني", () => {
    expect(resolveUnitPrice(pricing, 50)).toBe(12);
    expect(resolveUnitPrice(pricing, 49)).toBe(13);
    expect(resolveLineTotal(pricing, 49)).toBe(637);
  });
});

describe("resolveUnitPrice — مستويان", () => {
  const pricing = toTierPricing({
    sale_price: "20",
    pricing_mode: "two_tier",
    tier2_min_qty: 10,
    tier2_price: "13",
  });

  it.each([
    [1, 20],
    [9, 20],
    [10, 13],
    [49, 13],
    [50, 13],
    [51, 13],
  ])("كمية %i ⇒ %i درهم (لا يوجد مستوى ثالث)", (quantity, expected) => {
    expect(resolveUnitPrice(pricing, quantity)).toBe(expected);
  });
});

describe("resolveUnitPrice — ثمن واحد", () => {
  const pricing = toTierPricing(SINGLE_ROW);

  it.each([1, 9, 10, 49, 50, 51, 500])("كمية %i تبقى بثمن 150 درهم", (quantity) => {
    expect(resolveUnitPrice(pricing, quantity)).toBe(150);
  });

  it("المجموع خطي تماماً", () => {
    expect(resolveLineTotal(pricing, 1)).toBe(150);
    expect(resolveLineTotal(pricing, 3)).toBe(450);
  });

  it("عتبات مخصَّصة غير 10 و50 تعمل كما هي (غير مثبَّتة في الكود)", () => {
    const custom = toTierPricing({
      sale_price: "8",
      pricing_mode: "three_tier",
      tier2_min_qty: 24,
      tier2_price: "6.5",
      tier3_min_qty: 144,
      tier3_price: "5",
    });
    expect(resolveUnitPrice(custom, 23)).toBe(8);
    expect(resolveUnitPrice(custom, 24)).toBe(6.5);
    expect(resolveUnitPrice(custom, 143)).toBe(6.5);
    expect(resolveUnitPrice(custom, 144)).toBe(5);
  });
});

describe("resolveVariantPricing", () => {
  const productPricing = toTierPricing(MONTRI_ROW);

  it("متغيّر بثمن خاص يُعامَل كثمن واحد ولا ترثه المستويات", () => {
    const variantPricing = resolveVariantPricing(productPricing, "18.00", true);
    expect(variantPricing.mode).toBe("single");
    expect(resolveUnitPrice(variantPricing, 1)).toBe(18);
    expect(resolveUnitPrice(variantPricing, 100)).toBe(18);
  });

  it("متغيّر بلا ثمن خاص يرث سلَّم أثمنة المنتج الأب كاملاً", () => {
    const variantPricing = resolveVariantPricing(productPricing, "20.00", false);
    expect(variantPricing).toEqual(productPricing);
    expect(resolveUnitPrice(variantPricing, 50)).toBe(12);
  });
});

describe("describeTiers", () => {
  it("ثمن واحد لا يعرض أي صف (لا tiers فارغة)", () => {
    expect(describeTiers(toTierPricing(SINGLE_ROW))).toEqual([]);
  });

  it("ثلاثة مستويات بحد أدنى 1", () => {
    expect(describeTiers(toTierPricing(MONTRI_ROW), 1)).toEqual([
      { minQty: 1, maxQty: 9, unitPrice: 20 },
      { minQty: 10, maxQty: 49, unitPrice: 13 },
      { minQty: 50, maxQty: null, unitPrice: 12 },
    ]);
  });

  it("مستويان: الأخير مفتوح", () => {
    const pricing = toTierPricing({
      sale_price: "20",
      pricing_mode: "two_tier",
      tier2_min_qty: 10,
      tier2_price: "13",
    });
    expect(describeTiers(pricing, 1)).toEqual([
      { minQty: 1, maxQty: 9, unitPrice: 20 },
      { minQty: 10, maxQty: null, unitPrice: 13 },
    ]);
  });

  it("حد أدنى للطلب أكبر من 1 يبدأ الجدول منه لا من 1", () => {
    expect(describeTiers(toTierPricing(MONTRI_ROW), 5)[0]).toEqual({
      minQty: 5,
      maxQty: 9,
      unitPrice: 20,
    });
  });

  it("حد أدنى يتجاوز بداية الجملة لا يعرض مستوى أول لا يمكن شراؤه أبداً", () => {
    const rows = describeTiers(toTierPricing(MONTRI_ROW), 20);
    expect(rows).toEqual([
      { minQty: 20, maxQty: 49, unitPrice: 13 },
      { minQty: 50, maxQty: null, unitPrice: 12 },
    ]);
  });
});

describe("roundMoney", () => {
  it("يمنع انزلاق الفاصلة العائمة", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(12.005 * 3)).toBe(36.02);
  });

  it("مجموع السطر مُقرَّب إلى سنتيمين (يطابق numeric(10,2))", () => {
    const pricing: TierPricing = {
      mode: "single",
      unitPrice: 33.33,
      tier2MinQty: null,
      tier2Price: null,
      tier3MinQty: null,
      tier3Price: null,
    };
    expect(resolveLineTotal(pricing, 3)).toBe(99.99);
  });
});

describe("حالات حدّية", () => {
  const pricing = toTierPricing(MONTRI_ROW);

  it("كمية صفر أو سالبة ترجع ثمن المستوى الأول بدل الانهيار", () => {
    expect(resolveUnitPrice(pricing, 0)).toBe(20);
    expect(resolveUnitPrice(pricing, -5)).toBe(20);
  });

  it("كمية غير رقمية ترجع ثمن المستوى الأول", () => {
    expect(resolveUnitPrice(pricing, Number.NaN)).toBe(20);
  });
});
