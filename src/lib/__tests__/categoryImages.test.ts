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

  test("تصنيفا سخان الماء لا يستعملان الصورة المدموجة", () => {
    // الملف ما زال فـpublic/ (لم يُحذف)، لكن لا تصنيف يشير إليه — البطاقتان
    // تأخذان غلافاً من منتجات كلٍّ منهما عبر getCategoryCoverImages.
    expect(getCategoryImage("gas-water-heater-parts")).toBeNull();
    expect(getCategoryImage("electric-water-heater-parts")).toBeNull();
  });

  test("تصنيف بلا صورة مصمَّمة يُرجع null لا مساراً مكسوراً", () => {
    expect(getCategoryImage("panini-maker-parts")).toBeNull();
    expect(getCategoryImage("سلوق-غير-موجود")).toBeNull();
  });
});
