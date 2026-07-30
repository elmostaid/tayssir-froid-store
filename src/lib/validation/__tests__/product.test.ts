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
