import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORY_IMAGES, getCategoryImage } from "@/lib/categoryImages";

/**
 * حارس على صور بطاقات التصنيفات.
 *
 * ما وقع فعلاً: `gas-water-heater-parts.jpg` و`electric-water-heater-parts.jpg`
 * كانا **الملف نفسه بايتاً ببايت**، ونصّ الصورة المطبوع داخلها يقول «قطع
 * غيار سخان الماء الغازي والكهربائي». فالزبون يرى بطاقتين بنفس الصورة ونفس
 * العنوان، بينما التصنيفان منفصلان فقاعدة البيانات ولكلٍّ منتجاته.
 *
 * الاختبار الحاسم هنا ليس أن هذين السطرين حُذفا (يمكن لأي أحد أن يعيدهما
 * بحسن نيّة)، بل أن **لا صورتين مرتبطتين بتصنيفين مختلفين تحملان نفس
 * المحتوى** — أي عودة للعطل نفسه بأي اسمين تسقط هنا.
 */
const PUBLIC_DIR = join(process.cwd(), "public");

describe("صور بطاقات التصنيفات", () => {
  test("كل صورة مرتبطة بتصنيف موجودة فعلاً فـpublic/", () => {
    for (const [slug, path] of Object.entries(CATEGORY_IMAGES)) {
      expect(existsSync(join(PUBLIC_DIR, path)), `${slug} → ${path}`).toBe(true);
    }
  });

  test("لا تصنيفان يتقاسمان نفس الصورة", () => {
    const slugsByDigest = new Map<string, string[]>();

    for (const [slug, path] of Object.entries(CATEGORY_IMAGES)) {
      const digest = createHash("md5").update(readFileSync(join(PUBLIC_DIR, path))).digest("hex");
      slugsByDigest.set(digest, [...(slugsByDigest.get(digest) ?? []), slug]);
    }

    const shared = [...slugsByDigest.values()].filter((slugs) => slugs.length > 1);
    expect(shared, `تصنيفات تتقاسم نفس ملف الصورة: ${JSON.stringify(shared)}`).toEqual([]);
  });

  test("لكلٍّ من تصنيفَي سخان الماء صورته الخاصة، لا الصورة المدموجة", () => {
    const gas = getCategoryImage("gas-water-heater-parts");
    const electric = getCategoryImage("electric-water-heater-parts");

    expect(gas).not.toBeNull();
    expect(electric).not.toBeNull();
    expect(gas).not.toBe(electric);

    // والأهم: ليستا الملف المدموج القديم الذي كان يجمع التصنيفين في صورة
    // واحدة (اختبار "لا تصنيفان يتقاسمان نفس الصورة" أعلاه يحرس التطابق
    // البايتي، وهذا يحرس العودة إلى الملف القديم بعينه).
    const MERGED = "c416b8c6e696d626a998006c13a078a3";
    for (const path of [gas, electric]) {
      const digest = createHash("md5")
        .update(readFileSync(join(PUBLIC_DIR, path!)))
        .digest("hex");
      expect(digest).not.toBe(MERGED);
    }
  });

  test("تصنيف بلا صورة مصمَّمة يُرجع null لا مساراً مكسوراً", () => {
    expect(getCategoryImage("panini-maker-parts")).toBeNull();
    expect(getCategoryImage("سلوق-غير-موجود")).toBeNull();
  });
});
