import { describe, expect, test } from "vitest";
import {
  SECTION_IMAGE_PATH_RE,
  SECTION_SIZE,
  findSectionSlot,
  isSectionImageUrl,
  parseSectionConfig,
  partFamily,
  selectSectionProducts,
  type RankedProduct,
} from "@/lib/campaignSections";

const BASE = "https://proj.supabase.co/storage/v1/object/public/product-images/";
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const standard = findSectionSlot("washing-machines:standard")!;
const semi = findSectionSlot("washing-machines:semi")!;

function product(id: number, name: string, extra: Partial<RankedProduct> = {}): RankedProduct {
  return { id, name_ar: name, status: "published", stock_quantity: 10, ...extra } as RankedProduct;
}

describe("partFamily", () => {
  test("الكلمة الأولى، بلا تشكيل ولا علامات", () => {
    expect(partFamily("موطور صابون 150 واط")).toBe("موطور");
    expect(partFamily("مُوطُور نشاف")).toBe("موطور");
    expect(partFamily("  منتري (تايمر) 15 دقيقة")).toBe("منتري");
    expect(partFamily("Pompe vidange LG")).toBe("pompe");
    expect(partFamily("قفل-باب أوتوماتيك")).toBe("قفل");
  });

  test("أسماء الشوفو، وإملاءان آخران لنفس الصنف يُوحَّدان", () => {
    expect(partFamily("ممبرام شوفو غاز شنوة صغيرة")).toBe("ممبرام");
    expect(partFamily("دويت شوفو غاز فلتاج صغير")).toBe("دويت");
    expect(partFamily("حوان شوفو كهرباء موديل 04")).toBe("جوان");
    expect(partFamily("جوان شوفو كهرباء موديل 02")).toBe("جوان");
    expect(partFamily("ريجستونس شوفو ضوء فلتاج")).toBe("ريجيستونس");
  });
});

describe("findSectionSlot", () => {
  test("الأنواع الثلاثة لمكينات الصابون، والغاز والكهرباء للشوفو", () => {
    expect(standard.categorySlug).toBe("standard-washing-machine-parts");
    expect(findSectionSlot("washing-machines:automatic")).not.toBeNull();
    expect(findSectionSlot("water-heaters:gas")?.categorySlug).toBe("gas-water-heater-parts");
    expect(findSectionSlot("water-heaters:electric")?.categorySlug).toBe("electric-water-heater-parts");
    expect(findSectionSlot("water-heaters:solar")).toBeNull();
  });
});

describe("صور العرض للأقسام", () => {
  test("المسار في مجلد الخانة والمنتج نفسهما فقط", () => {
    const path = `campaign-products/washing-machines-standard/12/${UUID}.jpg`;
    expect(SECTION_IMAGE_PATH_RE.test(path)).toBe(true);
    expect(isSectionImageUrl(`${BASE}${path}`, standard, 12)).toBe(true);
    expect(isSectionImageUrl(`${BASE}${path}`, standard, 13)).toBe(false);
    expect(isSectionImageUrl(`${BASE}${path}`, semi, 12)).toBe(false);
    expect(isSectionImageUrl(`http://x${BASE.slice(8)}${path}`, standard, 12)).toBe(false);
    expect(SECTION_IMAGE_PATH_RE.test(`campaign-products/washing-machines-standard/12/../x.jpg`)).toBe(false);
  });

  test("مجلد الشوفو منفصل: صورة الغاز لا تُقبل للكهرباء", () => {
    const gas = findSectionSlot("water-heaters:gas")!;
    const electric = findSectionSlot("water-heaters:electric")!;
    const path = `campaign-products/water-heaters-gas/40/${UUID}.jpg`;
    expect(SECTION_IMAGE_PATH_RE.test(path)).toBe(true);
    expect(isSectionImageUrl(`${BASE}${path}`, gas, 40)).toBe(true);
    expect(isSectionImageUrl(`${BASE}${path}`, electric, 40)).toBe(false);
    expect(SECTION_IMAGE_PATH_RE.test(`campaign-products/other-page-gas/40/${UUID}.jpg`)).toBe(false);
  });
});

describe("parseSectionConfig", () => {
  test("قراءة دفاعية: مدخلات غريبة تُتجاهل، والتكرار يُحذف، والحد 4", () => {
    const good = `${BASE}campaign-products/washing-machines-standard/5/${UUID}.jpg`;
    const config = parseSectionConfig({
      "washing-machines:standard": [
        { productId: 5, image: good },
        { productId: 5 },
        { productId: "6" },
        { productId: -1 },
        null,
        { productId: 7, image: `${BASE}campaign-products/washing-machines-standard/99/${UUID}.jpg` },
        { productId: 8 },
        { productId: 9 },
      ],
      "water-heaters:gas": [{ productId: 1 }],
      "water-heaters:solar": [{ productId: 2 }],
      "washing-machines:semi": "bad",
    });
    expect(config["washing-machines:standard"]).toEqual([
      { productId: 5, image: good },
      { productId: 6 },
      { productId: 7 },
      { productId: 8 },
    ]);
    expect(config["water-heaters:gas"]).toEqual([{ productId: 1 }]);
    expect(Object.keys(config)).toEqual(["washing-machines:standard", "water-heaters:gas"]);
    expect(parseSectionConfig(null)).toEqual({});
    expect(parseSectionConfig([])).toEqual({});
  });
});

describe("selectSectionProducts", () => {
  const ranked = [
    product(1, "موطور صابون 150 واط"),
    product(2, "موطور نشاف 70 واط"),
    product(3, "منتري 15 دقيقة"),
    product(4, "منتري 30 دقيقة"),
    product(5, "بولي كبيرة", { status: "out_of_stock", stock_quantity: 0 }),
    product(6, "بولي صغيرة"),
    product(7, "جلدة باب"),
    product(8, "قفل باب"),
  ];

  test("تلقائياً: الأكثر طلباً بقطعة واحدة من كل صنف، بلا نافد", () => {
    const items = selectSectionProducts(ranked);
    expect(items.map((item) => item.product.id)).toEqual([1, 3, 6, 7]);
    expect(items.every((item) => item.source === "auto")).toBe(true);
    expect(items).toHaveLength(SECTION_SIZE);
  });

  test("اليدوي أولاً بترتيبه، ثم الإكمال بأصناف لم تظهر", () => {
    const items = selectSectionProducts(ranked, [{ productId: 8 }, { productId: 2, image: "x" }]);
    expect(items.map((item) => [item.product.id, item.source])).toEqual([
      [8, "manual"],
      [2, "manual"],
      [3, "auto"],
      [6, "auto"],
    ]);
    expect(items[1].displayImage).toBe("x");
    expect(items[0].displayImage).toBeNull();
  });

  test("منتج يدوي اختفى من التصنيف (مسودة/نقل) يُتخطّى بلا سقوط", () => {
    const items = selectSectionProducts(ranked, [{ productId: 999 }, { productId: 7 }]);
    expect(items[0].product.id).toBe(7);
    expect(items[0].source).toBe("manual");
    expect(items).toHaveLength(4);
  });

  test("منتج نافد اختاره المدير يبقى (قراره)، والتلقائي لا يقترحه", () => {
    const items = selectSectionProducts(ranked, [{ productId: 5 }]);
    expect(items[0].product.id).toBe(5);
    expect(items.map((item) => item.product.id)).toEqual([5, 1, 3, 7]);
  });

  test("أربعة يدوية ⇒ لا إكمال", () => {
    const manual = [3, 1, 8, 7].map((productId) => ({ productId }));
    expect(selectSectionProducts(ranked, manual).map((item) => item.product.id)).toEqual([3, 1, 8, 7]);
  });
});
