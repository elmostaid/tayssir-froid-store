"use server";

import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";

// السلة (localStorage جانب العميل) لا تخزّن سوى storage_path الخام —
// resolveProductImageUrl يعتمد على fs فلا يمكن استدعاؤه مباشرة من مكوّن
// "use client" (CartPageClient). هذا الإجراء غلاف رقيق فقط حول نفس المصدر
// المركزي resolveProductImageUrls؛ لا منطق حل روابط مختلف هنا إطلاقاً.
export async function resolveCartImageUrls(storagePaths: string[]): Promise<Record<string, string>> {
  return resolveProductImageUrls(storagePaths.filter((p): p is string => Boolean(p)));
}
