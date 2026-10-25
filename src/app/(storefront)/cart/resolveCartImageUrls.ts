"use server";

import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";
import { processedOriginals } from "@/lib/images/manifest";
import { webpSrcSet } from "@/lib/images/variants";

// السلة (localStorage جانب العميل) لا تخزّن سوى storage_path الخام —
// resolveProductImageUrl يعتمد على fs فلا يمكن استدعاؤه مباشرة من مكوّن
// "use client" (CartPageClient). هذا الإجراء غلاف رقيق فقط حول نفس المصدر
// المركزي resolveProductImageUrls؛ لا منطق حل روابط مختلف هنا إطلاقاً.
export async function resolveCartImageUrls(storagePaths: string[]): Promise<Record<string, string>> {
  return resolveProductImageUrls(storagePaths.filter((p): p is string => Boolean(p)));
}

/**
 * نفس الحلّ، مع `srcset` نسخة WebP حين تكون مولَّدة.
 *
 * لماذا من الخادم لا من المكوّن: `CartPageClient` هو "use client"، وقراءة
 * المانيفست فيه كانت سترسل قائمة مئات المسارات إلى متصفّح كل زبون لأجل
 * ثلاثة أسطر فـالسلة. الحساب هنا يُبقي المانيفست خادمياً بالكامل ويُرسل
 * سلسلة واحدة لكل صورة.
 *
 * صورة السلة عرضها 80px، فـ360 تكفيها على أعلى كثافة — ولا داعي لإعلان
 * مرشّحات أكبر لن يختارها المتصفح أبداً.
 */
export async function resolveCartImageSources(
  storagePaths: string[]
): Promise<Record<string, { src: string; srcSet: string | null }>> {
  const paths = storagePaths.filter((p): p is string => Boolean(p));
  const srcByPath = await resolveProductImageUrls(paths);
  const processed = processedOriginals();
  const out: Record<string, { src: string; srcSet: string | null }> = {};
  for (const p of paths) {
    const src = srcByPath[p];
    if (!src) continue;
    out[p] = { src, srcSet: webpSrcSet(p, processed, [360]) };
  }
  return out;
}
