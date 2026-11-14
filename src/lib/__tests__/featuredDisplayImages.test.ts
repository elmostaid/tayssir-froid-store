import { describe, expect, test } from "vitest";
import { FEATURED_OBJECT_PATH_RE, isFeaturedImageUrl, parseFeaturedDisplayImages } from "@/lib/featuredDisplayImages";

const UUID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const BASE = "https://proj.supabase.co/storage/v1/object/public/product-images/";

describe("صور العرض في «الأكثر طلباً»", () => {
  test("مجلد منفصل عن صور المنتجات وصور الحملات", () => {
    expect(FEATURED_OBJECT_PATH_RE.test(`featured/12/${UUID}.jpg`)).toBe(true);
    expect(FEATURED_OBJECT_PATH_RE.test(`12/${UUID}.jpg`)).toBe(false);
    expect(FEATURED_OBJECT_PATH_RE.test(`campaign/water-heaters-gas/${UUID}.jpg`)).toBe(false);
    expect(FEATURED_OBJECT_PATH_RE.test(`featured/12/../13/${UUID}.jpg`)).toBe(false);
  });

  test("المدخل لا يعرض إلا صورة من مجلد نفس المنتج", () => {
    expect(isFeaturedImageUrl(`${BASE}featured/12/${UUID}.jpg`, 12)).toBe(true);
    expect(isFeaturedImageUrl(`${BASE}featured/13/${UUID}.jpg`, 12)).toBe(false);
    expect(isFeaturedImageUrl(`https://evil.example/featured/12/${UUID}.jpg`, 12)).toBe(false);
  });

  test("قيمة تالفة ⇒ صور المنتجات كما هي", () => {
    expect(parseFeaturedDisplayImages(null)).toEqual({});
    expect(parseFeaturedDisplayImages([])).toEqual({});
    expect(
      parseFeaturedDisplayImages({
        "12": { path: `${BASE}featured/12/${UUID}.jpg` },
        "13": { path: `${BASE}featured/12/${UUID}.jpg` },
        abc: { path: `${BASE}featured/12/${UUID}.jpg` },
        "14": "x",
      })
    ).toEqual({ "12": { path: `${BASE}featured/12/${UUID}.jpg` } });
  });
});
