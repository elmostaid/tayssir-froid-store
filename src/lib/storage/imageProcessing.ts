/**
 * معالجة صورة المنتج في المتصفح قبل رفعها.
 *
 * لماذا هذا الملف أصلاً: الصور كانت تُرفع بحجمها الأصلي من الكاميرا. قياس
 * حقيقي من مخزن الإنتاج: صورة واحدة 3000×4000 (12 ميغابكسل) وزنها 5.1
 * ميغابايت، تُعرض فعلياً في بطاقة عرضها 220 بكسل — و`images.unoptimized`
 * مفعَّل، فلا يوجد أي تصغير من الخادم: الزائر ينزّل الملف كاملاً.
 *
 * إعادة الترميز عبر canvas تحلّ أربع مشاكل دفعة واحدة:
 *   1. التصغير إلى حد معقول للعرض.
 *   2. تطبيق اتجاه EXIF فعلياً على البكسلات (لا الاعتماد على المتصفح).
 *   3. حذف EXIF/ICC وكل الميتاداتا (إعادة الترميز تُسقطها) — أخفّ، وبلا
 *      ماركة الهاتف ولا موقع التصوير.
 *   4. توحيد الصيغة إلى JPEG baseline. صيغة WebP هي بالذات ما وثّقه
 *      migration 20260815000000 كسبب الصور المكسورة على الأجهزة القديمة
 *      (حاوية VP8X+ICC)، فلا نُنتج WebP جديداً من هنا إطلاقاً.
 */

export const MAX_UPLOAD_INPUT_BYTES = 12 * 1024 * 1024; // مدخل: صور الهواتف
export const MAX_LONG_EDGE = 1600; // أكبر عرض فعلي 500px ×2 لشاشات Retina + هامش
export const TARGET_OUTPUT_BYTES = 300 * 1024; // هدف عملي
export const HARD_OUTPUT_LIMIT_BYTES = 1024 * 1024; // سقف صلب بعد المعالجة
export const OUTPUT_MIME = "image/jpeg" as const;
export const OUTPUT_EXT = "jpg" as const;
const BASE_QUALITY = 0.82;

export const HEIC_MESSAGE =
  "صور HEIC/HEIF غير مدعومة. من إعدادات الكاميرا اختر «الأكثر توافقاً» أو JPEG، ثم أعد المحاولة.";

export type SniffedType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "unknown";

/**
 * يتعرّف على نوع الملف الحقيقي من بايتاته الأولى، لا من file.type.
 *
 * ضروري لسببين: بعض منتقيات الملفات على أندرويد تُعيد file.type فارغاً
 * لملف JPEG سليم تماماً (فكان يُرفض بلا سبب حقيقي)، وفي الاتجاه المعاكس لا
 * ينبغي أن نثق بنوع يدّعيه العميل. البايتات الأولى هي المصدر الوحيد
 * الموثوق.
 */
export function sniffImageType(bytes: Uint8Array): SniffedType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  // HEIC/HEIF: صندوق ftyp في أول 12 بايت بعلامة نوعية معروفة.
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (["heic", "heix", "hevc", "heim", "heis", "hevm", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
  }
  return "unknown";
}

/**
 * يقرأ وسم EXIF Orientation (1..8) من ملف JPEG. يُعيد 1 إن غاب أو تعذّرت
 * القراءة — أي "لا تدوير"، وهو التصرّف الآمن.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) break;
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1) {
      const exifStart = offset + 4;
      if (
        exifStart + 6 <= view.byteLength &&
        view.getUint32(exifStart) === 0x45786966 // "Exif"
      ) {
        const tiff = exifStart + 6;
        if (tiff + 8 > view.byteLength) return 1;
        const little = view.getUint16(tiff) === 0x4949;
        const ifdOffset = view.getUint32(tiff + 4, little);
        const ifd = tiff + ifdOffset;
        if (ifd + 2 > view.byteLength) return 1;
        const count = view.getUint16(ifd, little);
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          if (entry + 12 > view.byteLength) break;
          if (view.getUint16(entry, little) === 0x0112) {
            const value = view.getUint16(entry + 8, little);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
      }
      return 1;
    }
    if (size <= 0) break;
    offset += 2 + size;
  }
  return 1;
}

/** الأبعاد بعد التصغير، مع الحفاظ على النسبة. لا تكبير أبداً. */
export function fitWithinLongEdge(
  width: number,
  height: number,
  maxLongEdge = MAX_LONG_EDGE
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** هل يقلب هذا الاتجاه العرض والارتفاع؟ (90/270 درجة) */
export function orientationSwapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/**
 * تحويل canvas الذي يجعل البكسلات نفسها في الاتجاه الصحيح.
 *
 * لا نعتمد على `image-orientation` في المتصفح: WebView القديم على أندرويد
 * (Chrome أقدم من 81) يتجاهله تماماً، وهي بالضبط الأجهزة التي يدعمها هذا
 * المتجر — فصورة بوسم 6 أو 8 كانت ستظهر مقلوبة عندهم. بعد هذا التحويل
 * وإعادة الترميز، الملف الناتج بلا EXIF أصلاً فلا شيء يبقى ليُفسَّر خطأً.
 */
export function orientationTransform(
  orientation: number,
  width: number,
  height: number
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  switch (orientation) {
    case 2:
      return { a: -1, b: 0, c: 0, d: 1, e: width, f: 0 };
    case 3:
      return { a: -1, b: 0, c: 0, d: -1, e: width, f: height };
    case 4:
      return { a: 1, b: 0, c: 0, d: -1, e: 0, f: height };
    case 5:
      return { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0 };
    case 6:
      return { a: 0, b: 1, c: -1, d: 0, e: height, f: 0 };
    case 7:
      return { a: 0, b: -1, c: -1, d: 0, e: height, f: width };
    case 8:
      return { a: 0, b: -1, c: 1, d: 0, e: 0, f: width };
    default:
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
}

/**
 * صورة اختبار 2×1 بوسم EXIF Orientation = 6.
 * لو طبّق المتصفح الاتجاه بنفسه أثناء فك الترميز، ستُفَك بأبعاد 1×2.
 */
const ORIENTATION_PROBE_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDACgcHiMeGSgjISMtKygwPGRBPDc3PHtYXUlkkYCZlo+AjIqgtObDoKrarYqMyP/L2u71////m8H////6/+b9//j/2wBDASstLTw1PHZBQXb4pYyl+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCrRRRXOewf/9k=";

let decoderAppliesOrientationCache: Promise<boolean> | null = null;

/**
 * هل يطبّق فاكّ ترميز هذا المتصفح اتجاه EXIF من تلقاء نفسه؟
 *
 * لا يمكن الاعتماد على الخيار `imageOrientation: "none"`: تحقّقنا عملياً على
 * Chromium أن الأبعاد المُعادة تكون مقلوبة أصلاً حتى مع هذا الخيار — أي أن
 * الاتجاه طُبِّق رغم طلبنا عدم تطبيقه. لو طبّقناه نحن أيضاً لدارت الصورة
 * مرّتين، وهو ما يجعل الاتجاهين 6 و8 (وهما الأشيع في تصوير الهواتف) ينتجان
 * نفس النتيجة الخاطئة.
 *
 * الفحص الحقيقي هو الحكم: نفكّ ترميز صورة معروفة الاتجاه ونقارن الأبعاد.
 * النتيجة تُحسب مرّة واحدة لكل جلسة. المتصفحات القديمة التي لا تطبّق الاتجاه
 * تُعطي false هنا، فنطبّقه نحن — وهو بالضبط الهدف من دعم الأجهزة القديمة.
 */
export async function decoderAppliesOrientation(): Promise<boolean> {
  if (!decoderAppliesOrientationCache) {
    decoderAppliesOrientationCache = (async () => {
      try {
        const bin = atob(ORIENTATION_PROBE_JPEG_BASE64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        const swapped = bitmap.width === 1 && bitmap.height === 2;
        if (typeof bitmap.close === "function") bitmap.close();
        return swapped;
      } catch {
        return false; // الأسلم: نطبّقه بأنفسنا
      }
    })();
  }
  return decoderAppliesOrientationCache;
}

export type ProcessResult =
  | { ok: true; file: File; width: number; height: number; bytes: number }
  | { ok: false; error: string };

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, OUTPUT_MIME, quality));
}

/**
 * يحوّل ملفاً مختاراً من الهاتف إلى JPEG جاهز للرفع.
 * يُرجع رسالة عربية واضحة بدل رمي استثناء عند أي رفض.
 */
export async function processImageForUpload(file: File): Promise<ProcessResult> {
  if (file.size === 0) return { ok: false, error: "الملف فارغ." };
  if (file.size > MAX_UPLOAD_INPUT_BYTES) {
    return { ok: false, error: "حجم الصورة كبير جداً (12 ميغابايت كحد أقصى)." };
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sniffed = sniffImageType(bytes);

  if (sniffed === "image/heic") return { ok: false, error: HEIC_MESSAGE };
  if (sniffed === "unknown") {
    return { ok: false, error: "هذا الملف ليس صورة مدعومة. استعمل JPG أو PNG." };
  }

  const declaredOrientation = sniffed === "image/jpeg" ? readJpegOrientation(bytes) : 1;
  // إن كان المتصفح قد طبّق الاتجاه أثناء فك الترميز، فالبكسلات صحيحة أصلاً
  // ولا يجوز تطبيقه مرّة ثانية.
  const orientation = (await decoderAppliesOrientation()) ? 1 : declaredOrientation;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: sniffed }));
  } catch {
    return { ok: false, error: "تعذّرت قراءة الصورة. جرّب صورة أخرى." };
  }

  const rawWidth = bitmap.width;
  const rawHeight = bitmap.height;
  // الأبعاد بعد الدوران هي ما يجب أن يُقاس عليه التصغير.
  const orientedWidth = orientationSwapsAxes(orientation) ? rawHeight : rawWidth;
  const orientedHeight = orientationSwapsAxes(orientation) ? rawWidth : rawHeight;
  const target = fitWithinLongEdge(orientedWidth, orientedHeight);

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, error: "تعذّرت معالجة الصورة على هذا الجهاز." };

  // خلفية بيضاء قبل الرسم: JPEG لا يدعم الشفافية، وبدون هذا تصبح المناطق
  // الشفافة في PNG سوداء بالكامل.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scale = target.width / orientedWidth;
  const t = orientationTransform(orientation, rawWidth * scale, rawHeight * scale);
  ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.drawImage(bitmap, 0, 0, rawWidth * scale, rawHeight * scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  // ننزل بالجودة تدريجياً للاقتراب من الهدف، ثم نصغّر الأبعاد إن لزم — حتى
  // لا نتجاوز السقف الصلب أبداً.
  let blob = await canvasToBlob(canvas, BASE_QUALITY);
  for (const quality of [0.72, 0.62, 0.52]) {
    if (blob && blob.size <= TARGET_OUTPUT_BYTES) break;
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob && blob.size > HARD_OUTPUT_LIMIT_BYTES) {
    const smaller = fitWithinLongEdge(target.width, target.height, 1200);
    const c2 = document.createElement("canvas");
    c2.width = smaller.width;
    c2.height = smaller.height;
    const ctx2 = c2.getContext("2d");
    if (ctx2) {
      ctx2.fillStyle = "#ffffff";
      ctx2.fillRect(0, 0, c2.width, c2.height);
      ctx2.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      blob = await canvasToBlob(c2, 0.6);
    }
  }

  if (!blob) return { ok: false, error: "تعذّر تحويل الصورة. جرّب صورة أخرى." };
  if (blob.size > HARD_OUTPUT_LIMIT_BYTES) {
    return { ok: false, error: "تعذّر تصغير هذه الصورة بما يكفي. جرّب صورة أوضح أو أصغر." };
  }

  const name = file.name.replace(/\.[^.]+$/, "") || "image";
  return {
    ok: true,
    file: new File([blob], `${name}.${OUTPUT_EXT}`, { type: OUTPUT_MIME }),
    width: canvas.width,
    height: canvas.height,
    bytes: blob.size,
  };
}
