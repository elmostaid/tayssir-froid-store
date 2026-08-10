import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { buildMetaFeed, metaFeedRowsToCsv } from "@/lib/feed/metaFeed";

// خلاصة /api/meta-feed.csv مصدرها الوحيد public.catalog_products — نفس
// المصدر الذي تعتمد عليه صفحات الموقع الحقيقية للزبون. نختبر بمنتجات
// معزولة (بادئة SKU فريدة) بدل الاعتماد على عدد كلي ثابت لمنتجات الإنتاج
// (يختلف حسب البيئة)، لضمان استقرار الاختبار في أي قاعدة بيانات.
const SKU_PREFIX = "TEST-FIXTURE-METAFEED-";
let categoryId: number;

async function cleanupFixtures() {
  await sql`delete from public.product_images where product_id in (
    select id from public.products where sku like ${SKU_PREFIX + "%"}
  )`;
  await sql`delete from public.products where sku like ${SKU_PREFIX + "%"}`;
  await sql`delete from public.categories where slug = 'test-fixture-metafeed-category'`;
}

beforeAll(async () => {
  await cleanupFixtures();

  const [category] = await sql<{ id: number }[]>`
    insert into public.categories (slug, name_ar, is_active)
    values ('test-fixture-metafeed-category', 'تصنيف اختبار خلاصة ميتا', true)
    returning id
  `;
  categoryId = category.id;

  // منتج منشور، بصورة رئيسية — يجب أن يظهر فالخلاصة بكل الحقول صحيحة.
  const [withImage] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, description_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status
    ) values (
      ${SKU_PREFIX + "WITH-IMAGE"}, 'test-fixture-metafeed-with-image', ${categoryId},
      'منتج اختبار بصورة', 'وصف تجريبي للمنتج', 'قطعة', 1, 1, 149.90, 7, 'published'
    ) returning id
  `;
  await sql`
    insert into public.product_images (product_id, storage_path, is_primary, sort_order)
    values (${withImage.id}, ${"product-images/" + SKU_PREFIX + "WITH-IMAGE/main.jpg"}, true, 1)
  `;

  // منتج منشور، بلا أي صورة — يجب أن يُستبعَد كلياً (لا image_link فارغ).
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status
    ) values (
      ${SKU_PREFIX + "NO-IMAGE"}, 'test-fixture-metafeed-no-image', ${categoryId},
      'منتج اختبار بلا صورة', 'قطعة', 1, 1, 50.00, 3, 'published'
    )
  `;

  // منتج منشور بمخزون صفر — يظهر لكن availability = out of stock.
  const [zeroStock] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status
    ) values (
      ${SKU_PREFIX + "ZERO-STOCK"}, 'test-fixture-metafeed-zero-stock', ${categoryId},
      'منتج اختبار نفد مخزونه', 'قطعة', 1, 1, 75.50, 0, 'published'
    ) returning id
  `;
  await sql`
    insert into public.product_images (product_id, storage_path, is_primary, sort_order)
    values (${zeroStock.id}, ${"product-images/" + SKU_PREFIX + "ZERO-STOCK/main.jpg"}, true, 1)
  `;

  // منتج مسوَّدة (draft) — الـview نفسها تستبعده، يجب ألا يظهر إطلاقاً.
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, sale_price, stock_quantity, status
    ) values (
      ${SKU_PREFIX + "DRAFT"}, 'test-fixture-metafeed-draft', ${categoryId},
      'منتج اختبار مسودة', 'قطعة', 1, 1, 999.00, 5, 'draft'
    )
  `;
});

afterAll(async () => {
  await cleanupFixtures();
});

function fixtureRows(rows: Awaited<ReturnType<typeof buildMetaFeed>>["rows"]) {
  return rows.filter((r) => r.id.startsWith(SKU_PREFIX));
}

describe("buildMetaFeed (public.catalog_products → /api/meta-feed.csv)", () => {
  test("منتج منشور بصورة: كل الحقول صحيحة والرابط دائماً إنتاج tayssirfroid.com", async () => {
    const result = await buildMetaFeed();
    const row = fixtureRows(result.rows).find((r) => r.id === SKU_PREFIX + "WITH-IMAGE");
    expect(row).toBeTruthy();
    expect(row!.title).toBe("منتج اختبار بصورة");
    expect(row!.description).toBe("وصف تجريبي للمنتج");
    expect(row!.availability).toBe("in stock");
    expect(row!.condition).toBe("new");
    expect(row!.price).toBe("149.90 MAD");
    expect(row!.brand).toBe("Tayssir Froid");
    expect(row!.product_type).toBe("تصنيف اختبار خلاصة ميتا");
    expect(row!.link).toBe("https://www.tayssirfroid.com/product/test-fixture-metafeed-with-image");
    expect(row!.image_link).toBe(
      `https://www.tayssirfroid.com/product-images/${SKU_PREFIX}WITH-IMAGE/main.jpg`
    );
  });

  test("منتج بلا صورة رئيسية: مستبعد كلياً من الخلاصة (لا سطر بـimage_link فارغ)", async () => {
    const result = await buildMetaFeed();
    const row = fixtureRows(result.rows).find((r) => r.id === SKU_PREFIX + "NO-IMAGE");
    expect(row).toBeUndefined();
    expect(result.excludedNoImageSkus).toContain(SKU_PREFIX + "NO-IMAGE");
  });

  test("منتج بمخزون صفر: يظهر فالخلاصة لكن availability = out of stock", async () => {
    const result = await buildMetaFeed();
    const row = fixtureRows(result.rows).find((r) => r.id === SKU_PREFIX + "ZERO-STOCK");
    expect(row).toBeTruthy();
    expect(row!.availability).toBe("out of stock");
  });

  test("منتج مسوَّدة (draft): لا يظهر إطلاقاً (الـview تستبعده قبل حتى وصول الكود لهذا المنطق)", async () => {
    const result = await buildMetaFeed();
    const row = fixtureRows(result.rows).find((r) => r.id === SKU_PREFIX + "DRAFT");
    expect(row).toBeUndefined();
  });

  test("كل الروابط (link وimage_link) لكل الصفوف تبدأ حصراً بـ https://www.tayssirfroid.com/", async () => {
    const result = await buildMetaFeed();
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.link.startsWith("https://www.tayssirfroid.com/")).toBe(true);
      expect(row.image_link.startsWith("https://www.tayssirfroid.com/")).toBe(true);
      // ممنوع localhost أو أي preview.
      expect(row.link).not.toMatch(/localhost|vercel\.app/);
      expect(row.image_link).not.toMatch(/localhost|vercel\.app/);
    }
  });

  test("لا يوجد id (SKU) مكرر فالخلاصة كاملة", async () => {
    const result = await buildMetaFeed();
    const ids = result.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.duplicateSkus).toEqual([]);
  });

  test("لا يحوي أي صف ثمن الشراء أو أي حقل إداري داخلي", async () => {
    const result = await buildMetaFeed();
    for (const row of result.rows) {
      expect(Object.keys(row)).not.toContain("purchase_price");
      expect(Object.keys(row).sort()).toEqual(
        [
          "availability",
          "brand",
          "condition",
          "description",
          "id",
          "image_link",
          "link",
          "price",
          "product_type",
          "title",
        ].sort()
      );
    }
  });

  test("CSV: ترميز UTF-8 حقيقي بلا BOM، والأسماء العربية تبقى صحيحة", async () => {
    const result = await buildMetaFeed();
    const csv = metaFeedRowsToCsv(result.rows);

    expect(csv.startsWith("﻿")).toBe(false);
    const buffer = Buffer.from(csv, "utf-8");
    expect(buffer[0]).not.toBe(0xef); // أول بايت من BOM لو وُجد

    expect(csv).toContain("منتج اختبار بصورة");
    expect(csv.split("\r\n")[0]).toBe(
      "id,title,description,availability,condition,price,link,image_link,brand,product_type"
    );
  });
});
