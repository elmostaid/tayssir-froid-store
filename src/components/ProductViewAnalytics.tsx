"use client";

import { useEffect, useRef } from "react";
import { trackAnalyticsEvent } from "@/lib/analytics/track";

/**
 * product_view — مرة واحدة لكل منتج معروض فعلاً.
 *
 * مكوّن منفصل تماماً عن ProductViewContentPixel (الخاص بـMeta) ولا يستورده
 * ولا يستورد أي شيء من lib/pixel: القياس الداخلي ونظام Meta مساران
 * مستقلان بالكامل، فتعطّل أحدهما لا يمسّ الآخر، وأي تعديل مستقبلي على
 * أحدهما لا يُخاطر بالثاني.
 *
 * لا نُرسل الثمن هنا عمداً: product_id وsku يكفيان، والثمن الحقيقي وقت
 * التقرير يُقرأ من جدول المنتجات نفسه — فلا نُكرّر معلومة قد تتقادم.
 */
export function ProductViewAnalytics({ productId, sku }: { productId: number; sku: string }) {
  const firedForSku = useRef<string | null>(null);

  useEffect(() => {
    if (firedForSku.current === sku) return;
    firedForSku.current = sku;
    trackAnalyticsEvent("product_view", { productId, sku });
  }, [productId, sku]);

  return null;
}
