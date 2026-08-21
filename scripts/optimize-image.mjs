import sharp from "sharp";

/**
 * قاعدة واحدة لكل صور الموقع: ضلع أطول محدود + JPEG baseline بلا بيانات
 * وصفية + جودة كافية لرؤية القطعة.
 *
 * لماذا JPEG وليس WebP/AVIF: مُحسِّن الصور فـVercel مقفل بـ402 على هذه
 * الخطة (تحقّقنا: أي تحويل جديد يُرجع OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED)،
 * فالملف الذي نخزّنه هو الملف الذي يصل الزبون حرفياً. JPEG يفتحه كل هاتف
 * أندرويد قديم بلا استثناء، وهو الفارق بين صورة تظهر وصورة لا تظهر.
 *
 * الأبعاد: 1000 بكسل للضلع الأطول. أعرض هاتف فالسوق المغربي ~430 نقطة
 * منطقية، أي 860 بكسل فيزيائياً على شاشة 2x — فـ1000 يكفي لعرض القطعة
 * بوضوح كامل على صفحة المنتج، وأي زيادة بعده بكسلات لا يراها أحد.
 */
export const MAX_LONG_EDGE = 1000;
export const JPEG_QUALITY = 80;
/** حدّ أقصى صارم: أي صورة أثقل تُعاد بجودة أقل تدريجياً حتى تنزل تحته. */
export const MAX_BYTES = 200 * 1024;

export async function optimizeImage(input) {
  const image = sharp(input, { failOn: "none" });
  const meta = await image.metadata();

  // الشفافية تصبح خلفية بيضاء: بطاقات المنتجات وصفحاتها كلها على أبيض،
  // فالنتيجة مطابقة بصرياً بينما يختفي ثقل PNG بالكامل.
  const pipeline = sharp(input, { failOn: "none" })
    .rotate() // يطبّق اتجاه EXIF ثم يُسقطه
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });

  for (const quality of [JPEG_QUALITY, 72, 65, 58]) {
    const out = await pipeline
      .clone()
      .jpeg({ quality, mozjpeg: true, progressive: false, chromaSubsampling: "4:2:0" })
      .toBuffer();
    if (out.length <= MAX_BYTES || quality === 58) {
      return { buffer: out, quality, width: meta.width, height: meta.height };
    }
  }
  throw new Error("unreachable");
}
