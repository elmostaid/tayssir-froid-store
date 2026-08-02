import { describe, expect, test } from "vitest";
import { buildCatalogExport, rowsToCsv } from "@/lib/feed/metaCatalog";

describe("buildCatalogExport (Meta Commerce Catalog)", () => {
  test("لا يستبعد أي منتج بسبب الصورة الرئيسية بعد إصلاح جميع الصور المشكوك فيها", async () => {
    const result = await buildCatalogExport();

    expect(result.totalProducts).toBeGreaterThan(0);
    expect(result.excludedFromFeed).toBe(0);
  });

  test("المنتج ذو الصورة الثانوية المشكوك فيها فقط (وليست الرئيسية) يبقى في الخلاصة", async () => {
    const result = await buildCatalogExport();
    expect(result.rows.some((r) => r.id === "TF-WM-004")).toBe(true);
  });

  test("كل صف يحتوي الحقول الأساسية ولا يحتوي أبداً على ثمن الشراء", async () => {
    const result = await buildCatalogExport();
    expect(result.rows.length).toBeGreaterThan(0);

    for (const row of result.rows) {
      expect(row.id).toBeTruthy();
      expect(row.title).toBeTruthy();
      expect(row.description).toBeTruthy();
      expect(["in stock", "out of stock"]).toContain(row.availability);
      expect(row.condition).toBe("new");
      expect(row.price).toMatch(/^\d+\.\d{2} MAD$/);
      expect(row.brand).toBe("Tayssir Froid");
      expect(Number.isInteger(row.inventory)).toBe(true);
      expect(JSON.stringify(row)).not.toContain("purchase_price");
    }
  });

  test("منتج فيه Variants يظهر بسطر مستقل لكل Variant مع item_group_id يساوي SKU المنتج", async () => {
    const result = await buildCatalogExport();
    const capillaryRows = result.rows.filter((r) => r.item_group_id === "TF-RF-083");
    expect(capillaryRows.length).toBe(3);
    for (const row of capillaryRows) {
      expect(row.id.startsWith("TF-RF-083-")).toBe(true);
    }
  });

  test("لا يوجد id مكرر في كامل الخلاصة", async () => {
    const result = await buildCatalogExport();
    const ids = result.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("rowsToCsv ينتج عنواناً صحيحاً وعدد أسطر مطابقاً لعدد الصفوف", async () => {
    const result = await buildCatalogExport();
    const csv = rowsToCsv(result.rows);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "id,title,description,availability,condition,price,link,image_link,brand,product_type,inventory,item_group_id"
    );
    expect(lines.length).toBe(result.rows.length + 1);
  });

  // انتبه: لا تُعِد إضافة UTF-8 BOM هنا. جُرِّب سابقاً لإصلاح ظهور العربية
  // مشوَّهة عند فتح الملف يدوياً في Excel، لكنه كسر استيراد Meta Commerce
  // Manager الآلي بالكامل (رسالة "تعذّر التعرّف على صيغة الملف") — على
  // الأرجح لأن محلِّل Meta لا يتجاهل BOM فيُلحقه حرفياً بأول عمود ("﻿id"
  // بدل "id"). صحة الاستيراد الآلي أهم من المعاينة اليدوية لهذا الملف.
  test("rowsToCsv لا يبدأ بـ BOM إطلاقاً (يكسر استيراد Meta الآلي رغم أنه يُصلح عرض Excel اليدوي)", async () => {
    const result = await buildCatalogExport();
    const csv = rowsToCsv(result.rows);

    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.startsWith("id,title,description")).toBe(true);

    // محاكاة قراءة صارمة كما يفعل محلِّل CSV آلي: أول عمود يجب أن يكون
    // "id" حرفياً بدون أي حرف خفي مُلحَق به.
    const [headerLine] = csv.split("\r\n");
    const [firstColumn] = headerLine.split(",");
    expect(firstColumn).toBe("id");

    // التأكد أن الترميز يبقى UTF-8 سليماً وأن العربية لا تُشوَّه بدون BOM.
    const bytes = new TextEncoder().encode(csv);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    const firstArabicName = result.rows[0].title;
    expect(decoded).toContain(firstArabicName);
  });
});
