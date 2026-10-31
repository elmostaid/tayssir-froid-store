import { getMetaPixelId } from "@/lib/pixel/config";
import { PixelPageViewTracker } from "@/components/PixelPageViewTracker";

/**
 * Meta Pixel — **لا يُحمَّل إلا بعد الموافقة.**
 *
 * كان سكريبت Pixel يُحقن في كل صفحة لكل زائر، ومعه صورة `<noscript>`
 * تُرسل PageView بلا JavaScript. الاثنان يودعان كوكي `_fbp` قبل أي سؤال،
 * ومداولة CNDP D-939-2025 تشترط الموافقة «قبل أول إيداع» لكوكيز الإشهار
 * المخصَّص. فصار التحميل في المتصفح، من PixelPageViewTracker، وفقط حين
 * يكون الاختيار `granted` — وحُذفت `<noscript>`: لا موافقة ممكنة بلا
 * JavaScript، فلا إيداع.
 *
 * هذا المكوّن يبقى على الخادم لسبب واحد: معرّف Pixel من الإعدادات يُمرَّر
 * من هنا. بدونه لا شيء يُحمَّل إطلاقاً، كما كان.
 */
export function MetaPixel() {
  const pixelId = getMetaPixelId();
  if (!pixelId) return null;
  return <PixelPageViewTracker pixelId={pixelId} />;
}
