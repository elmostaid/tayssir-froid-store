import { describe, expect, test } from "vitest";
import {
  sniffImageType,
  readJpegOrientation,
  fitWithinLongEdge,
  orientationSwapsAxes,
  orientationTransform,
  MAX_LONG_EDGE,
} from "@/lib/storage/imageProcessing";

/** يبني رأس JPEG حقيقياً بمقطع APP1/Exif يحمل وسم Orientation المطلوب. */
function jpegWithOrientation(orientation: number, littleEndian = false): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) =>
    littleEndian ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff];
  const u32 = (v: number) =>
    littleEndian
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d])); // byte order
  tiff.push(...u16(42));
  tiff.push(...u32(8)); // IFD0 offset
  tiff.push(...u16(1)); // one entry
  tiff.push(...u16(0x0112)); // Orientation tag
  tiff.push(...u16(3)); // SHORT
  tiff.push(...u32(1)); // count
  tiff.push(...u16(orientation), 0, 0); // value + padding
  tiff.push(...u32(0)); // next IFD

  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const segLength = exif.length + 2;
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (segLength >> 8) & 0xff, segLength & 0xff, // APP1
    ...exif,
    0xff, 0xd9, // EOI
  ]);
}

describe("sniffImageType — النوع الحقيقي من البايتات لا من file.type", () => {
  test("JPEG يُتعرَّف عليه ولو كان file.type فارغاً (حالة بعض هواتف أندرويد)", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
  });

  test("PNG", () => {
    expect(
      sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBe("image/png");
  });

  test("WebP", () => {
    const b = new Uint8Array(12);
    b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    expect(sniffImageType(b)).toBe("image/webp");
  });

  test("HEIC يُتعرَّف عليه ليُرفَض برسالة واضحة بدل تخزين ملف لن يظهر", () => {
    const b = new Uint8Array(12);
    b.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
    b.set([0x68, 0x65, 0x69, 0x63], 8); // heic
    expect(sniffImageType(b)).toBe("image/heic");
    b.set([0x6d, 0x69, 0x66, 0x31], 8); // mif1 (HEIF)
    expect(sniffImageType(b)).toBe("image/heic");
  });

  test("ملف ليس صورة", () => {
    expect(sniffImageType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe("unknown");
  });
});

describe("readJpegOrientation — قراءة اتجاه EXIF", () => {
  // الحالات المطلوبة صراحةً: 1 (سليمة)، 6 (تدوير 90°)، 8 (تدوير 270°).
  test.each([1, 3, 6, 8])("يقرأ الاتجاه %i (big-endian)", (orientation) => {
    expect(readJpegOrientation(jpegWithOrientation(orientation))).toBe(orientation);
  });

  test.each([1, 6, 8])("يقرأ الاتجاه %i (little-endian)", (orientation) => {
    expect(readJpegOrientation(jpegWithOrientation(orientation, true))).toBe(orientation);
  });

  test("بلا EXIF: يُرجع 1 (لا تدوير) بدل الفشل", () => {
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
  });

  test("بايتات مشوَّهة: يُرجع 1 بأمان ولا يرمي", () => {
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00]))).toBe(1);
    expect(readJpegOrientation(new Uint8Array([]))).toBe(1);
  });

  test("قيمة خارج المدى 1..8 تُعامَل كـ1", () => {
    expect(readJpegOrientation(jpegWithOrientation(99))).toBe(1);
  });
});

describe("fitWithinLongEdge — التصغير", () => {
  test("صورة هاتف 3000×4000 (الحالة الحقيقية المقيسة) تصير ضلعها الأطول 1600", () => {
    const r = fitWithinLongEdge(3000, 4000);
    expect(Math.max(r.width, r.height)).toBe(MAX_LONG_EDGE);
    expect(r.width).toBe(1200);
    expect(r.height).toBe(1600);
  });

  test("النسبة محفوظة للصور العريضة", () => {
    const r = fitWithinLongEdge(4000, 2000);
    expect(r.width).toBe(1600);
    expect(r.height).toBe(800);
  });

  test("صورة أصغر من الحد لا تُكبَّر أبداً", () => {
    expect(fitWithinLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("orientationTransform — تطبيق الاتجاه على البكسلات", () => {
  test("الاتجاهات 5..8 تقلب المحورين، وغيرها لا", () => {
    for (const o of [5, 6, 7, 8]) expect(orientationSwapsAxes(o)).toBe(true);
    for (const o of [1, 2, 3, 4]) expect(orientationSwapsAxes(o)).toBe(false);
  });

  test("الاتجاه 1: مصفوفة الهوية (بلا أي تغيير)", () => {
    expect(orientationTransform(1, 100, 200)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });

  // نتحقّق أن كل اتجاه يُرسل زوايا الصورة إلى داخل الإطار المتوقَّع — وهو ما
  // يمنع فعلياً ظهور الصورة مقلوبة أو خارج الكادر على الأجهزة القديمة التي
  // لا تحترم وسم EXIF أصلاً.
  test.each([
    [2, 100, 200],
    [3, 100, 200],
    [4, 100, 200],
    [5, 100, 200],
    [6, 100, 200],
    [7, 100, 200],
    [8, 100, 200],
  ])("الاتجاه %i يُبقي الصورة داخل الإطار", (orientation, w, h) => {
    const t = orientationTransform(orientation, w, h);
    const apply = (x: number, y: number) => ({
      x: t.a * x + t.c * y + t.e,
      y: t.b * x + t.d * y + t.f,
    });
    const corners = [apply(0, 0), apply(w, 0), apply(0, h), apply(w, h)];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const swaps = orientationSwapsAxes(orientation);
    // بعد التحويل، المساحة المشغولة تساوي أبعاد الإطار (مقلوبة عند 5..8).
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(swaps ? h : w);
    expect(Math.max(...ys)).toBeCloseTo(swaps ? w : h);
  });
});
