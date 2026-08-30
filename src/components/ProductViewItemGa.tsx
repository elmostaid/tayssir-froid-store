"use client";

import { useEffect, useRef } from "react";
import { trackGaViewItem } from "@/lib/ga/ecommerce";

/**
 * view_item لـGA4 — مرة واحدة فقط لكل منتج معروض فعلاً.
 *
 * مكوّن منفصل بالكامل عن ProductViewContentPixel (Meta) وعن
 * ProductViewAnalytics (القياس الداخلي)، ولا يستورد شيئاً منهما: ثلاثة
 * مسارات قياس مستقلة، تعطّل أحدها لا يمسّ الآخرين — نفس الفصل القائم أصلاً
 * في هذه الصفحة.
 *
 * الـref يضمن حدثاً واحداً لكل sku مهما أُعيد رندر المكوّن.
 */
export function ProductViewItemGa({
  sku,
  name,
  price,
  category,
}: {
  sku: string;
  name: string;
  price: number;
  category?: string | null;
}) {
  const firedForSku = useRef<string | null>(null);

  useEffect(() => {
    if (firedForSku.current === sku) return;
    firedForSku.current = sku;
    trackGaViewItem({ sku, name, price, category });
  }, [sku, name, price, category]);

  return null;
}
