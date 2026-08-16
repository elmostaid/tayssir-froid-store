import { afterEach, describe, expect, test, vi } from "vitest";
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

  // كان هذا الاختبار يُثبِّت SKU بعينه ("TF-RF-083") وعدد Variants محفوظاً (3)
  // من لقطة بيانات الإنتاج — فيفشل على أي قاعدة اختبار، وأيضاً لو حذف المدير
  // Variant واحداً من ذلك المنتج بالذات. الثابتة الحقيقية التي يصفها العنوان
  // لا علاقة لها بذلك المنتج: أي منتج له Variants يجب أن تكون كل أسطره
  // مسبوقة بـSKU الأب. نتحقّق منها الآن على كل مجموعات الخلاصة.
  test("منتج فيه Variants يظهر بسطر مستقل لكل Variant مع item_group_id يساوي SKU المنتج", async () => {
    const result = await buildCatalogExport();
    const variantRows = result.rows.filter((r) => r.item_group_id);
    const groups = new Set(variantRows.map((r) => r.item_group_id));

    expect(groups.size).toBeGreaterThan(0);
    for (const row of variantRows) {
      expect(row.id.startsWith(`${row.item_group_id}-`)).toBe(true);
    }
    // كل مجموعة لها سطر واحد على الأقل (لا مجموعة فارغة).
    for (const groupId of groups) {
      expect(variantRows.some((r) => r.item_group_id === groupId)).toBe(true);
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

  describe("مع SITE_URL مضبوط (كما هو الحال فعلياً على Vercel)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // حارس دائم ضد أي رجوع لهذه المشكلة: كل صف بلا استثناء يجب أن يملك
    // image_link و link مطلقين وHTTPS، وليس فارغاً أو نسبياً — هذا بالضبط ما
    // يحتاجه Meta Commerce Manager ليجلب الصور، ولم يكن أي اختبار سابق
    // يتحقق منه فعلياً لأن SITE_URL لم يكن مضبوطاً في بيئة الاختبار.
    test("كل صف من الـ162 يملك image_link و link مطلقين بصيغة https صحيحة، بدون استثناء", async () => {
      vi.stubEnv("SITE_URL", "https://tayssir-froid-store-git-product-upda-4deb4c-elmostaids-projects.vercel.app");

      const result = await buildCatalogExport();
      expect(result.rows.length).toBeGreaterThan(0);

      const emptyImageLink = result.rows.filter((r) => !r.image_link.trim());
      const invalidImageLink = result.rows.filter(
        (r) => r.image_link.trim() && !/^https:\/\/\S+$/.test(r.image_link)
      );
      const invalidLink = result.rows.filter((r) => !/^https:\/\/\S+$/.test(r.link));

      expect(emptyImageLink.map((r) => r.id)).toEqual([]);
      expect(invalidImageLink.map((r) => r.id)).toEqual([]);
      expect(invalidLink.map((r) => r.id)).toEqual([]);
    });
  });
});
