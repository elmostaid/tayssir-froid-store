import { describe, expect, test } from "vitest";
import { productSchema, variantSchema } from "@/lib/validation/product";

function validProductInput() {
  return {
    sku: "ABC-123",
    slug: "test-product",
    categoryId: 1,
    nameAr: "منتج اختبار",
    nameFr: "",
    descriptionAr: "",
    technicalSpecs: "",
    unitLabel: "قطعة",
    minOrderQty: 1,
    qtyIncrement: 1,
    purchasePrice: null,
    salePrice: 100,
    stockQuantity: 10,
    status: "draft" as const,
    // منتج بثمن واحد — الحالة الافتراضية لكل المنتجات الحالية
    pricingMode: "single" as const,
    tier2MinQty: null,
    tier2Price: null,
    tier3MinQty: null,
    tier3Price: null,
    showBulkWhatsapp: false,
  };
}

describe("productSchema", () => {
  test("يقبل مدخلات صحيحة كاملة", () => {
    const result = productSchema.safeParse(validProductInput());
    expect(result.success).toBe(true);
  });

  test("يرفض SKU يحتوي رموزاً غير مسموحة", () => {
    const result = productSchema.safeParse({ ...validProductInput(), sku: "abc/123 مع مسافة" });
    expect(result.success).toBe(false);
  });

  test("يرفض slug بأحرف كبيرة أو رموزاً غير مسموحة", () => {
    const result = productSchema.safeParse({ ...validProductInput(), slug: "Test_Product!" });
    expect(result.success).toBe(false);
  });

  test("يرفض ثمن بيع سالب", () => {
    const result = productSchema.safeParse({ ...validProductInput(), salePrice: -10 });
    expect(result.success).toBe(false);
  });

  test("يرفض حالة (status) غير معروفة", () => {
    const result = productSchema.safeParse({ ...validProductInput(), status: "unknown_status" });
    expect(result.success).toBe(false);
  });

  test("يرفض غياب الاسم العربي", () => {
    const result = productSchema.safeParse({ ...validProductInput(), nameAr: "" });
    expect(result.success).toBe(false);
  });

  test("يقبل حالة out_of_stock", () => {
    const result = productSchema.safeParse({ ...validProductInput(), status: "out_of_stock" });
    expect(result.success).toBe(true);
  });
});

describe("variantSchema", () => {
  test("يقبل مدخلات صحيحة كاملة", () => {
    const result = variantSchema.safeParse({
      variantName: "مقاس A",
      salePriceOverride: null,
      stockQuantity: 5,
      minOrderQtyOverride: null,
      qtyIncrementOverride: null,
      isActive: true,
      sortOrder: 0,
    });
    expect(result.success).toBe(true);
  });

  test("يرفض اسم متغير فارغ", () => {
    const result = variantSchema.safeParse({
      variantName: "",
      salePriceOverride: null,
      stockQuantity: 5,
      minOrderQtyOverride: null,
      qtyIncrementOverride: null,
      isActive: true,
      sortOrder: 0,
    });
    expect(result.success).toBe(false);
  });

  test("يرفض مخزوناً سالباً", () => {
    const result = variantSchema.safeParse({
      variantName: "مقاس A",
      salePriceOverride: null,
      stockQuantity: -1,
      minOrderQtyOverride: null,
      qtyIncrementOverride: null,
      isActive: true,
      sortOrder: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("productSchema — التسعير المتدرِّج", () => {
  function tieredInput(overrides: Record<string, unknown> = {}) {
    return {
      ...validProductInput(),
      salePrice: 20,
      minOrderQty: 1,
      pricingMode: "three_tier" as const,
      tier2MinQty: 10,
      tier2Price: 13,
      tier3MinQty: 50,
      tier3Price: 12,
      ...overrides,
    };
  }

  test("يقبل 3 مستويات صحيحة (حالة المنتري)", () => {
    expect(productSchema.safeParse(tieredInput()).success).toBe(true);
  });

  test("يقبل مستويين بلا حقول المستوى الثالث", () => {
    const result = productSchema.safeParse(
      tieredInput({ pricingMode: "two_tier", tier3MinQty: null, tier3Price: null })
    );
    expect(result.success).toBe(true);
  });

  test("يرفض مستويين بلا ثمن جملة", () => {
    const result = productSchema.safeParse(
      tieredInput({ pricingMode: "two_tier", tier2Price: null, tier3MinQty: null, tier3Price: null })
    );
    expect(result.success).toBe(false);
  });

  test("يرفض مستويين بلا كمية بداية الجملة", () => {
    const result = productSchema.safeParse(
      tieredInput({ pricingMode: "two_tier", tier2MinQty: null, tier3MinQty: null, tier3Price: null })
    );
    expect(result.success).toBe(false);
  });

  test("يرفض مستوى ثالث لا يبدأ بعد الثاني", () => {
    expect(productSchema.safeParse(tieredInput({ tier3MinQty: 10 })).success).toBe(false);
    expect(productSchema.safeParse(tieredInput({ tier3MinQty: 5 })).success).toBe(false);
  });

  test("يرفض بداية جملة لا تتجاوز الكمية الدنيا للطلب (منتج لن يُباع أبداً بثمن القطعة)", () => {
    const result = productSchema.safeParse(tieredInput({ minOrderQty: 10, tier2MinQty: 10 }));
    expect(result.success).toBe(false);
  });

  test("العتبات ليست مثبَّتة على 10 و50 — أي قيم أخرى مقبولة", () => {
    const result = productSchema.safeParse(
      tieredInput({ tier2MinQty: 24, tier2Price: 6.5, tier3MinQty: 144, tier3Price: 5 })
    );
    expect(result.success).toBe(true);
  });

  test("ثمن واحد + واتساب للكميات الكبيرة: مقبول (الخاصيتان مستقلتان)", () => {
    const result = productSchema.safeParse({
      ...validProductInput(),
      showBulkWhatsapp: true,
    });
    expect(result.success).toBe(true);
  });

  test("نمط تسعير غير معروف يُرفض", () => {
    expect(productSchema.safeParse(tieredInput({ pricingMode: "four_tier" })).success).toBe(false);
  });
});
