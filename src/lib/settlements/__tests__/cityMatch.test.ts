import { describe, expect, it } from "vitest";
import { compareCities } from "@/lib/settlements/cityMatch";

describe("مقارنة مدينة الفاتورة بمدينة الطلبية", () => {
  it.each([
    ["Tahla", "تاهلة"],
    ["Stehat", "سطيحات"],
    ["Bouarfa", "بوعرفة"],
    ["Tarfaya", "طرفاية"],
    ["Erfoud", "ارفود"],
    ["Beni Ahmed chamal", "بني احمد إقليم الشاون"],
    ["Tanger", "طنجة"],
    ["Casablanca", "الدار البيضاء"],
    ["Agadir", "أكادير"],
    ["Marrakech", "مراكش"],
    ["El Jadida", "El Jadida"],
  ])("%s ≈ %s", (a, b) => {
    expect(compareCities(a, b)).toBe("match");
  });

  it("دوار باسم آخر غير المدينة = مختلفة (تحتاج قرار المالك، لا رفض)", () => {
    expect(compareCities("Moulay Abellah Amghar", "El Jadida")).toBe("differ");
    expect(compareCities("Rabat", "مكناس")).toBe("differ");
  });

  it("نص لا يكفي للمقارنة = غير معروف", () => {
    expect(compareCities("", "فاس")).toBe("unknown");
    expect(compareCities("Laayoune", "العيون")).toBe("unknown");
    expect(compareCities(null, "فاس")).toBe("unknown");
  });
});
