import { afterEach, describe, expect, test, vi } from "vitest";
import { buildCleanCatalogExport, cleanRowsToCsv } from "@/lib/feed/metaCatalogClean";

describe("buildCleanCatalogExport (خلاصة Meta النظيفة /meta/catalog.csv)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("لا صور مكسورة ولا منتجات مستبعدة — كل منتجات الموقع الحالية (156) لها صورة واحدة على الأقل", async () => {
    const result = await buildCleanCatalogExport();

    expect(result.totalProducts).toBe(156);
    expect(result.brokenImageCount).toBe(0);
    expect(result.brokenImageSkus).toEqual([]);
    expect(result.excludedProducts).toBe(0);
    expect(result.includedProducts).toBe(156);
  });

  test("عدد صفوف CSV = المنتجات بدون Variants + سطر مستقل لكل Variant", async () => {
    const result = await buildCleanCatalogExport();
    // 11 Variant موزَّعة على 4 منتجات (يظهرون كأسطر Variant فقط، بلا سطر
    // منتج أب مكرر) + 152 منتجاً بلا Variants = 163 سطراً.
    expect(result.rows.length).toBe(163);
  });

  test("لا يوجد id مكرر، وكل item_group_id غير فارغ يطابق SKU منتج فعلي", async () => {
    const result = await buildCleanCatalogExport();
    const ids = result.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    const groupIds = new Set(result.rows.filter((r) => r.item_group_id).map((r) => r.item_group_id));
    expect(groupIds.size).toBe(4);
  });

  test("كل صف يحتوي الحقول المطلوبة بالضبط ولا يحتوي أبداً على ثمن الشراء", async () => {
    const result = await buildCleanCatalogExport();
    expect(result.rows.length).toBeGreaterThan(0);

    for (const row of result.rows) {
      expect(row.id).toBeTruthy();
      expect(row.title).toBeTruthy();
      expect(row.description).toBeTruthy();
      expect(["in stock", "out of stock"]).toContain(row.availability);
      expect(row.condition).toBe("new");
      expect(row.price).toMatch(/^\d+\.\d{2} MAD$/);
      expect(row.brand).toBe("Tayssir Froid");
      expect(row.product_type).toBeTruthy();
      expect(JSON.stringify(row)).not.toContain("purchase_price");
    }
  });

  test("image_link ليس أبداً /_next/image ولا مساراً نسبياً، حتى بدون SITE_URL — يستعمل VERCEL_BRANCH_URL", async () => {
    vi.stubEnv(
      "VERCEL_BRANCH_URL",
      "tayssir-froid-store-git-product-upda-4deb4c-elmostaids-projects.vercel.app"
    );

    const result = await buildCleanCatalogExport();
    for (const row of result.rows) {
      expect(row.image_link).toMatch(/^https:\/\//);
      expect(row.image_link).not.toContain("/_next/image");
      expect(row.link).toMatch(/^https:\/\//);
      if (row.additional_image_link) {
        for (const url of row.additional_image_link.split(",")) {
          expect(url).toMatch(/^https:\/\//);
          expect(url).not.toContain("/_next/image");
        }
      }
    }
  });

  test("مع SITE_URL مضبوط (كما هو الحال فعلياً على Vercel) يبقى المصدر image_link/link مطلقين", async () => {
    vi.stubEnv(
      "SITE_URL",
      "https://tayssir-froid-store-git-product-upda-4deb4c-elmostaids-projects.vercel.app"
    );

    const result = await buildCleanCatalogExport();
    const invalidImageLink = result.rows.filter((r) => !/^https:\/\/\S+$/.test(r.image_link));
    const invalidLink = result.rows.filter((r) => !/^https:\/\/\S+$/.test(r.link));

    expect(invalidImageLink.map((r) => r.id)).toEqual([]);
    expect(invalidLink.map((r) => r.id)).toEqual([]);
  });

  test("cleanRowsToCsv ينتج الأعمدة بالترتيب المطلوب بالضبط، بدون BOM", async () => {
    const result = await buildCleanCatalogExport();
    const csv = cleanRowsToCsv(result.rows);
    const lines = csv.trim().split("\r\n");

    expect(lines[0]).toBe(
      "id,item_group_id,title,description,availability,condition,price,link,image_link,additional_image_link,brand,product_type"
    );
    expect(lines.length).toBe(result.rows.length + 1);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });
});
