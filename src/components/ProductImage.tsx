import { preload } from "react-dom";
import { processedOriginals } from "@/lib/images/manifest";
import { webpSrcSet, CARD_WIDTHS, variantPath, type VariantWidth } from "@/lib/images/variants";

/**
 * صورة منتج واحدة: نسخة WebP خفيفة متى وُجدت، والأصل دائماً كشبكة أمان.
 *
 * ## لماذا `<picture>` بدل `<Image>`
 *
 * `images.unoptimized: true` مضبوط في `next.config.ts` عمداً (خدمة تحسين
 * الصور فـVercel أعادت `402 PAYMENT_REQUIRED`). فـ`<Image>` يُصيَّر وسم
 * `<img>` عادياً **بلا srcset إطلاقاً** — قِسناه على الإنتاج: السمة غائبة
 * تماماً. أي أن المكوّن لم يعد يقدّم شيئاً هنا سوى التحميل الكسول والجلب
 * المسبق، وكلاهما سطر واحد يدوياً. و`<picture>` يعطي ما لا يعطيه:
 * **تفاوض الصيغة** — متصفح لا يفكّ WebP يتجاهل `<source>` ويأخذ `<img>`.
 *
 * ## ثلاث طبقات أمان، لا واحدة
 *
 * `migration 20260815000000` وثّق صوراً مكسورة متقطّعة سببها **WebP
 * بحاوية VP8X+ICC** وأسماء غير ASCII. فالاحتياط ثلاثي:
 *
 *   1. **لا srcset أصلاً** ما لم يُثبت المولِّد أنه أنتج النسخ (المانيفست).
 *      فلا رابط مُعلَن بلا ملف.
 *   2. **`<source type="image/webp">`** — يغطّي عدم دعم الصيغة.
 *   3. **`ImageFallbackScript`** — يغطّي ما لا يغطّيه `<picture>` إطلاقاً:
 *      ملف يرجع 404، أو تعثّر شبكة، أو بايتات تالفة. في هذه الحالات
 *      المتصفح **لا** يتراجع إلى `<img>` من تلقائه بل يعرض صورة مكسورة —
 *      وهذا بالضبط ما يُصلحه الحارس.
 *
 * والأصل لا يُحذف ولا يُعاد تسميته أبداً، فالطبقة الثالثة تجد دائماً ما
 * تسقط إليه.
 */
export function ProductImage({
  storagePath,
  resolvedSrc,
  alt,
  sizes,
  widths = CARD_WIDTHS,
  priority = false,
  width,
  height,
  className,
}: {
  /** المسار كما هو في `product_images.storage_path` — مفتاح المانيفست. */
  storagePath: string;
  /** الرابط الجاهز للأصل (من `resolveProductImageUrl`). */
  resolvedSrc: string;
  alt: string;
  sizes: string;
  /** `null` = لا نسخة محسَّنة لهذه الصورة عمداً (انظر صفحة المنتج). */
  widths?: readonly VariantWidth[] | null;
  priority?: boolean;
  /** أبعاد جوهرية تحجز المكان قبل التحميل (للشعار). البطاقات لا تحتاجها: إطارها ثابت النسبة. */
  width?: number;
  height?: number;
  className?: string;
}) {
  const srcSet = webpSrcSet(storagePath, processedOriginals(), widths);

  // الجلب المسبق لصور فوق الطيّة. `imageSrcSet` يجعل المتصفح يحجز **نفس**
  // النسخة التي سيختارها الوسم لاحقاً، لا الأصل — وإلا نزّلنا الاثنين.
  if (priority) {
    if (srcSet) {
      preload(variantPath(storagePath, widths![widths!.length - 1]), {
        as: "image",
        // بلا `type` يجلب متصفحٌ لا يفكّ WebP النسخةَ عبثاً ثم الأصل (قِيس
        // على المعاينة بإخفاء نوع <source>). مع `type` يتخطّى الجلب المسبق.
        type: "image/webp",
        imageSrcSet: srcSet,
        imageSizes: sizes,
        fetchPriority: "high",
      });
    } else {
      preload(resolvedSrc, { as: "image", fetchPriority: "high" });
    }
  }

  return (
    <picture>
      {srcSet && <source type="image/webp" srcSet={srcSet} sizes={sizes} />}
      <img
        src={resolvedSrc}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        // يقرأه الحارس ليعرف إلى أين يسقط. الأصل نفسه، فالسقوط لا يفشل.
        data-img-fallback={resolvedSrc}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        className={className}
      />
    </picture>
  );
}
