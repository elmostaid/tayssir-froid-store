import { describe, expect, test } from "vitest";
import { categorySchema } from "@/lib/validation/category";

function validCategoryInput() {
  return {
    nameAr: "قطع غيار الغسالات",
    nameFr: "",
    slug: "washing-machine-parts",
    parentId: null,
    sortOrder: 0,
    isActive: true,
  };
}

describe("categorySchema", () => {
  test("يقبل مدخلات صحيحة كاملة", () => {
    const result = categorySchema.safeParse(validCategoryInput());
    expect(result.success).toBe(true);
  });

  test("يرفض غياب الاسم العربي", () => {
    const result = categorySchema.safeParse({ ...validCategoryInput(), nameAr: "" });
    expect(result.success).toBe(false);
  });

  test("يرفض slug بصيغة غير صحيحة (أحرف كبيرة/مسافات)", () => {
    const result = categorySchema.safeParse({ ...validCategoryInput(), slug: "Washing Machine" });
    expect(result.success).toBe(false);
  });

  test("يرفض slug فارغاً", () => {
    const result = categorySchema.safeParse({ ...validCategoryInput(), slug: "" });
    expect(result.success).toBe(false);
  });

  test("يقبل parentId رقمياً موجباً", () => {
    const result = categorySchema.safeParse({ ...validCategoryInput(), parentId: 3 });
    expect(result.success).toBe(true);
  });
});
