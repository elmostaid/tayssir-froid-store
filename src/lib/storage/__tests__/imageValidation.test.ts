import { describe, expect, test } from "vitest";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, validateImageFile } from "@/lib/storage/imageValidation";

// بلا أي استيراد خادمي (fs، إلخ) — الغرض من هذا الملف المنفصل أصلاً أن يكون
// آمناً للاستيراد من مكوّنات "use client" (الفحص الفوري فالمتصفح قبل طلب
// رابط الرفع الموقَّع)، فهذا الاختبار يتأكد فقط من منطق الفحص نفسه.

function fileOfSize(bytes: number, type: string): File {
  return new File([new Uint8Array(bytes)], "x", { type });
}

describe("validateImageFile", () => {
  test("يقبل صيغة وحجماً صالحين", () => {
    expect(validateImageFile(fileOfSize(1024, "image/png"))).toBeNull();
  });

  test.each(ALLOWED_IMAGE_TYPES)("يقبل الصيغة %s", (type) => {
    expect(validateImageFile(fileOfSize(1024, type))).toBeNull();
  });

  test("يرفض صيغة غير مدعومة", () => {
    expect(validateImageFile(fileOfSize(1024, "application/pdf"))).toContain("صيغة الصورة غير مدعومة");
  });

  test("يرفض ملفاً فارغاً", () => {
    expect(validateImageFile(fileOfSize(0, "image/png"))).toContain("الملف فارغ");
  });

  test("يرفض ملفاً أكبر من الحد الأقصى", () => {
    expect(validateImageFile(fileOfSize(MAX_IMAGE_BYTES + 1, "image/png"))).toContain("حجم الصورة كبير جداً");
  });

  test("يقبل ملفاً بالضبط عند الحد الأقصى", () => {
    expect(validateImageFile(fileOfSize(MAX_IMAGE_BYTES, "image/png"))).toBeNull();
  });
});
