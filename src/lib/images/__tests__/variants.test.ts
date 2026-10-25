import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  VARIANT_WIDTHS,
  CARD_WIDTHS,
  THUMB_WIDTHS,
  contentKey,
  variantPath,
  webpSrcSet,
} from "@/lib/images/variants";
import manifest from "@/lib/images/variant-manifest.json";
import { verifyVariants } from "../../../../scripts/verify-image-variants.mjs";

/**
 * ما تحرسه هذه الاختبارات ليس حساباً بل **عطلاً تجارياً**: صورة قطعة غيار
 * لا تظهر، أو تظهر **قديمة** بعد تبديلها. كل حالة هنا مشتقّة من عطل وقع
 * فعلاً في هذا المتجر أو من فحص ما قبل النشر.
 */
describe("نسخ الصور المحسَّنة", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  test("لا srcset لأصل لم يُعالَج — وهذا هو الحارس الأول", () => {
    // `<picture>` يتراجع عن صيغة غير مدعومة، لكنه **لا يتراجع عن 404**.
    // فإعلان رابط نسخة غير موجودة = صورة مكسورة مؤكَّدة.
    expect(webpSrcSet("product-images/TF-X/TF-X.jpg", new Map())).toBeNull();
  });

  test("srcset يُبنى من بصمة المانيفست، وبكل العروض المطلوبة", () => {
    const p = "product-images/TF-CK-001/TF-CK-001.jpg";
    const got = webpSrcSet(p, new Map([[p, "0123456789abcdef"]]));
    expect(got).toBe("/_opt/0123456789abcdef-360.webp 360w, /_opt/0123456789abcdef-540.webp 540w");
  });

  test("widths فارغة أو null تعني «لا نسخة عمداً» لا خطأً", () => {
    const m = new Map([["x/y.jpg", "0123456789abcdef"]]);
    expect(webpSrcSet("x/y.jpg", m, null)).toBeNull();
    expect(webpSrcSet("x/y.jpg", m, [])).toBeNull();
  });

  /**
   * فحص ما قبل النشر رقم 4 سقط على الاسم المشتقّ من المسار: صورة تُستبدَل
   * بنفس مسارها كانت تُبقي نفس اسم النسخة، فتحتفظ الذاكرة المؤقتة بالقديمة.
   */
  test("محتوى مختلف = اسم مختلف، ومحتوى مطابق = نفس الاسم", () => {
    expect(contentKey(bytes("صورة قديمة"))).not.toBe(contentKey(bytes("صورة جديدة")));
    expect(contentKey(bytes("نفس الصورة"))).toBe(contentKey(bytes("نفس الصورة")));
  });

  test("اسم النسخة ASCII بحت بطول ثابت", () => {
    // الأسماء غير ASCII كانت أحد سببَي الصور المكسورة (migration 20260815000000).
    const v = variantPath(contentKey(bytes("موطور نشاف LG")), 540);
    expect(v).toMatch(/^\/_opt\/[0-9a-f]{16}-540\.webp$/);
  });

  test("المانيفست الحقيقي: كل البصمات بصيغة صحيحة وملفّاتها في public/_opt", () => {
    const files = new Set(readdirSync(path.join(process.cwd(), "public", "_opt")));
    const entries = Object.entries(manifest.variants as Record<string, string>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, key] of entries) {
      expect(key).toMatch(/^[0-9a-f]{16}$/);
      for (const w of VARIANT_WIDTHS) expect(files.has(`${key}-${w}.webp`)).toBe(true);
    }
  });

  /**
   * الحارس الذي يجعل الفحص 4 قابلاً للتكرار: كل أصل محلي في المانيفست
   * يجب أن تطابق بصمته محتواه الحالي. إن فشل هذا الاختبار فقد استُبدلت
   * صورة دون إعادة تشغيل المولِّد — والبناء سيعرضها بأصلها حتى يُعاد.
   */
  test("المانيفست الحقيقي: بصمة كل أصل محلي تطابق محتواه الحالي", () => {
    const stale: string[] = [];
    for (const [p, key] of Object.entries(manifest.variants as Record<string, string>)) {
      if (p.startsWith("http")) continue;
      const file = path.join(process.cwd(), "public", p);
      if (contentKey(readFileSync(file)) !== key) stale.push(p);
    }
    expect(stale).toEqual([]);
  });

  test("لا يوجد عرض 1080 — أُسقط بالقياس لا بالرأي", () => {
    // أصول المتجر 1200×1600 أصلاً، فـWebP@1080 خرج أكبر من الأصل بـ11%.
    expect([...VARIANT_WIDTHS]).toEqual([360, 540]);
    expect([...CARD_WIDTHS]).toEqual([360, 540]);
    expect([...THUMB_WIDTHS]).toEqual([360]);
  });

  test("العروض مشتقّة من بطاقة 171 CSS px", () => {
    // 171 × 2 = 342 ← 360 ، و171 × 3 = 513 ← 540.
    expect(360).toBeGreaterThanOrEqual(171 * 2);
    expect(540).toBeGreaterThanOrEqual(171 * 3);
  });
});

/**
 * فحص ما قبل البناء (`prebuild`): يُسقط أي نسخة لم تعد صحيحة فتُعرض
 * الصورة بأصلها بدل نسخة مكسورة أو قديمة.
 */
describe("verify-image-variants (فحص ما قبل البناء)", () => {
  let root: string;
  const put = (rel: string, data: string) => {
    const f = path.join(root, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, data);
  };
  const keyOf = (data: string) => contentKey(new TextEncoder().encode(data));

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "tf-variants-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("نسخة صالحة تبقى", () => {
    const k = keyOf("أصل");
    put("public/categories/a.jpg", "أصل");
    put(`public/_opt/${k}-360.webp`, "w");
    put(`public/_opt/${k}-540.webp`, "w");
    const r = verifyVariants(root, { "categories/a.jpg": k });
    expect(r.kept).toEqual({ "categories/a.jpg": k });
    expect(r.dropped).toEqual([]);
  });

  test("صورة استُبدلت بنفس مسارها ولم يُعَد التوليد ← تُسقط فتُعرض بأصلها الجديد", () => {
    const old = keyOf("الصورة القديمة");
    put(`public/_opt/${old}-360.webp`, "w");
    put(`public/_opt/${old}-540.webp`, "w");
    put("public/product-images-v3/TF-WM-005/TF-WM-005.jpg", "الصورة الجديدة");
    const r = verifyVariants(root, { "product-images-v3/TF-WM-005/TF-WM-005.jpg": old });
    expect(r.kept).toEqual({});
    expect(r.dropped[0].reason).toMatch(/تغيّر/);
  });

  test("ملف نسخة ناقص ← يُسقط بدل إعلان رابط 404", () => {
    const k = keyOf("أصل");
    put("public/categories/a.jpg", "أصل");
    put(`public/_opt/${k}-360.webp`, "w"); // 540 ناقص
    const r = verifyVariants(root, { "categories/a.jpg": k });
    expect(r.kept).toEqual({});
    expect(r.dropped[0].reason).toMatch(/ناقص/);
  });

  test("كائن مخزن لا يُعاد تنزيله: يكفي وجود ملفّيه", () => {
    const p = "https://x.supabase.co/storage/v1/object/public/product-images/1/u.jpg";
    put("public/_opt/0123456789abcdef-360.webp", "w");
    put("public/_opt/0123456789abcdef-540.webp", "w");
    const r = verifyVariants(root, { [p]: "0123456789abcdef" });
    expect(r.kept).toEqual({ [p]: "0123456789abcdef" });
  });
});
