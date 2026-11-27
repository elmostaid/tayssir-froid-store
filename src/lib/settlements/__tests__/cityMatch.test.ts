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

  // من فاتورة BigDelivery الحقيقية 1761 (نونبر 2026).
  it.each([
    ["sidi hajaj settat", "سيدي حجاج اولاد مراح"],
    ["Fes", "فاس بنسودا"],
    ["Ighrem Laalam", "بني ملال اغرم نلعلام"],
    ["Ksar Sghir", "لقصر الصغير"],
    ["El Jadida", "الجديدة"],
    ["Beni Mellal", "بني ملال"],
    ["Tanger", "طنجة"],
    ["Oujda", "وجدة"],
  ])("فاتورة حقيقية: %s ≈ %s", (a, b) => {
    expect(compareCities(a, b)).toBe("match");
  });

  it("الكلمات القصيرة بوحدها ما كتكفيش: مدن مختلفة كتبقى مختلفة", () => {
    expect(compareCities("Sidi Bennour", "سيدي بوزيد")).toBe("differ");
    expect(compareCities("Sidi Slimane", "سيدي قاسم")).toBe("differ");
    expect(compareCities("Fes", "مكناس")).toBe("differ");
    expect(compareCities("Ksar Sghir", "القصر الكبير")).toBe("differ");
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
