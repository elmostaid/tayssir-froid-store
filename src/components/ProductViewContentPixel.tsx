"use client";

import { useEffect, useRef } from "react";
import { trackViewContent } from "@/lib/pixel/fbq";

/**
 * ViewContent — مرة واحدة فقط لكل عرض صفحة منتج حقيقي. مكوّن مخصَّص لهذا
 * الغرض فقط (منفصل عن AddToCartForm عمداً) لأن صفحة المنتج نفسها Server
 * Component بحتة؛ هذا أصغر حد ممكن من كود "use client" الضروري لإطلاق
 * الحدث بالسعر/التصنيف الصحيحين من جهة الخادم مباشرة، بلا أي تأثير على
 * منطق عرض المنتج نفسه.
 */
export function ProductViewContentPixel({
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
    trackViewContent({ sku, name, price, category });
  }, [sku, name, price, category]);

  return null;
}
