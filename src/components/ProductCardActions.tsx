"use client";

import { useState } from "react";
import { useCart } from "@/components/CartProvider";
import { buildProductWhatsAppLink } from "@/lib/whatsapp";
import { trackAnalyticsEvent } from "@/lib/analytics/track";
import { trackGaAddToCart } from "@/lib/ga/ecommerce";
import type { EarlyAddPayload } from "@/lib/cart/earlyAdd";
import type { CatalogProduct } from "@/lib/types";

// إضافة سريعة للسلة من بطاقة المنتج (بالكمية الدنيا) — تُستعمل فقط للمنتجات
// بدون Variants، لأن اختيار المقاس/النوع يتطلب المرور بصفحة المنتج نفسها.
export function ProductCardActions({
  product,
  imageUrl,
  hasVariants,
  whatsappNumber,
}: {
  product: CatalogProduct;
  imageUrl: string | null;
  hasVariants: boolean;
  whatsappNumber: string;
}) {
  const { addItem, subtotal } = useCart();
  const [added, setAdded] = useState(false);
  const outOfStock = product.status === "out_of_stock" || product.stock_quantity <= 0;
  const whatsappLink = buildProductWhatsAppLink(whatsappNumber, product.name_ar, product.sku);

  const cartItem = {
    productId: product.id,
    variantId: null,
    slug: product.slug,
    sku: product.sku,
    name: product.name_ar,
    variantName: null,
    unitPrice: Number(product.sale_price),
    minOrderQty: product.min_order_qty,
    qtyIncrement: product.qty_increment,
    imageUrl,
  };

  // نفس الحمولة بالضبط التي يمرّرها handleAdd أدناه، مكتوبة في HTML نفسه
  // حتى يستطيع السكريبت المضمَّن تنفيذ الإضافة قبل وصول React. اشتقاقها من
  // نفس الكائن — لا نسخة ثانية — هو ما يضمن ألّا يفترقا مع الوقت.
  const earlyAdd: EarlyAddPayload = { ...cartItem, quantity: product.min_order_qty };

  function handleAdd() {
    if (outOfStock || hasVariants) return;
    addItem(cartItem, product.min_order_qty);
    // هذه الإضافة السريعة كانت غير مرئية تماماً قبل اليوم: لا لـMeta ولا
    // لنا. نسجّلها داخلياً الآن حتى يصبح عدد "من أضاف للسلة" في اللوحة
    // صادقاً. حدث Meta لا يُضاف هنا في هذه المرحلة عمداً — قرار منفصل
    // يحتاج موافقة، لأنه سيُغيّر أرقام الحملة فجأة ويكسر مقارنتها التاريخية.
    trackAnalyticsEvent("add_to_cart", {
      productId: product.id,
      sku: product.sku,
      quantity: product.min_order_qty,
      cartValue: subtotal + Number(product.sale_price) * product.min_order_qty,
    });
    // GA4 يُرسَل من هنا أيضاً، بخلاف حدث Meta أعلاه: هذا تركيب جديد بلا
    // أرقام تاريخية يمكن أن تنكسر مقارنتها، وإسقاط الإضافة السريعة كان
    // سيجعل add_to_cart في GA4 يقلّ عن الحقيقة بلا سبب.
    trackGaAddToCart({
      sku: product.sku,
      name: product.name_ar,
      price: Number(product.sale_price),
      quantity: product.min_order_qty,
      category: product.category_name_ar,
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      {hasVariants ? (
        <a
          href={`/product/${product.slug}`}
          className="flex min-h-11 flex-1 items-center justify-center rounded-full border border-brand-orange px-3 text-xs font-semibold text-brand-orange"
        >
          اختر المقاس
        </a>
      ) : (
        <button
          type="button"
          onClick={handleAdd}
          disabled={outOfStock}
          data-early-add={outOfStock ? undefined : JSON.stringify(earlyAdd)}
          className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-brand-orange px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-orange-dark disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {/* suppressHydrationWarning: قد يكون السكريبت المبكّر غيّر هذا
              النص إلى «تمت الإضافة ✓» قبل الترطيب. لا نريد تحذيراً ولا
              ترقيعاً وقت الترطيب — أول إعادة رندر بعد قراءة السلة تُعيده
              إلى ما يقوله React على أي حال. */}
          <span data-add-label suppressHydrationWarning>
            {outOfStock ? "غير متوفر" : added ? "✓ تمت الإضافة للسلة" : "أضف للسلة"}
          </span>
        </button>
      )}
      <a
        href={whatsappLink}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="اسأل عبر واتساب"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-whatsapp text-whatsapp-dark"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.11-1.34A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Zm0 18c-1.6 0-3.1-.43-4.4-1.19l-.32-.19-3.03.8.81-2.95-.2-.3A7.95 7.95 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8Zm4.4-5.9c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.44-1.34-1.68-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
        </svg>
      </a>
    </div>
  );
}
