"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { snapQuantity } from "@/lib/cart/cartMath";
import { formatMad } from "@/lib/format";
import { trackAddToCart } from "@/lib/pixel/fbq";
import { trackAnalyticsEvent } from "@/lib/analytics/track";
import { trackGaAddToCart } from "@/lib/ga/ecommerce";
import type { EarlyAddPayload } from "@/lib/cart/earlyAdd";
import type { CatalogProduct, CatalogProductVariant } from "@/lib/types";

export function AddToCartForm({
  product,
  variants,
  imageUrl,
}: {
  product: CatalogProduct;
  variants: CatalogProductVariant[];
  imageUrl: string | null;
}) {
  const router = useRouter();
  const { addItem, subtotal } = useCart();
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(
    variants[0]?.id ?? null
  );
  const [added, setAdded] = useState(false);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === selectedVariantId) ?? null,
    [variants, selectedVariantId]
  );

  const effective = {
    price: Number(selectedVariant?.sale_price ?? product.sale_price),
    minOrderQty: selectedVariant?.min_order_qty ?? product.min_order_qty,
    qtyIncrement: selectedVariant?.qty_increment ?? product.qty_increment,
    stock: selectedVariant?.stock_quantity ?? product.stock_quantity,
  };

  const [quantity, setQuantity] = useState(effective.minOrderQty);

  function handleVariantChange(variantId: number) {
    setSelectedVariantId(variantId);
    const variant = variants.find((v) => v.id === variantId);
    setQuantity(variant?.min_order_qty ?? product.min_order_qty);
    setAdded(false);
  }

  function step(direction: 1 | -1) {
    setQuantity((current) => {
      const next = current + direction * effective.qtyIncrement;
      return snapQuantity(
        Math.max(effective.minOrderQty, next),
        effective.minOrderQty,
        effective.qtyIncrement
      );
    });
    setAdded(false);
  }

  const outOfStock = effective.stock <= 0 || product.status === "out_of_stock";

  /**
   * الحمولة التي يقرأها السكريبت المضمَّن ليُضيف قبل وصول React.
   *
   * الكمية هنا هي الكمية الدنيا دائماً، وهذا ليس تبسيطاً: زرّا + و− لا
   * يعملان قبل الترطيب أصلاً، فالكمية المعروضة على الشاشة قبله هي الدنيا
   * يقيناً. فلا يمكن أن يفترق ما يراه الزبون عمّا يُضاف.
   *
   * ولا حمولة إطلاقاً لمنتج له مقاسات: اختيار المقاس نفسه يحتاج React،
   * فإضافة أوّل مقاس نيابةً عن الزبون قد تضع في سلّته ما لم يخترْه. الأمان
   * هنا أولى من السرعة — وهي نفس السياسة في بطاقة المنتج التي ترسله إلى
   * هذه الصفحة بدل الإضافة السريعة.
   */
  const earlyAdd: EarlyAddPayload | null =
    variants.length > 0 || outOfStock
      ? null
      : {
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
          quantity: product.min_order_qty,
        };

  function handleAddToCart() {
    if (outOfStock) return;

    addItem(
      {
        productId: product.id,
        variantId: selectedVariant?.id ?? null,
        slug: product.slug,
        sku: product.sku,
        name: product.name_ar,
        variantName: selectedVariant?.variant_name ?? null,
        unitPrice: effective.price,
        minOrderQty: effective.minOrderQty,
        qtyIncrement: effective.qtyIncrement,
        imageUrl,
      },
      quantity
    );
    // AddToCart يُطلَق هنا فقط — عند الإضافة الفعلية للسلة (بعد نجاح
    // addItem)، وليس عند مجرد فتح الصفحة أو تغيير الكمية/المقاس.
    trackAddToCart({
      sku: product.sku,
      name: product.name_ar,
      price: effective.price,
      quantity,
      category: product.category_name_ar,
    });
    // القياس الداخلي — مسار مستقل تماماً عن Meta أعلاه: لا يشاركه أي حالة
    // ولا يمكن أن يُغيّر سلوكه، وفشله لا يمنع إرسال حدث Meta ولا العكس.
    trackAnalyticsEvent("add_to_cart", {
      productId: product.id,
      sku: product.sku,
      quantity,
      cartValue: subtotal + effective.price * quantity,
    });
    // GA4 — مسار ثالث مستقل بنفس القاعدة: عند الإضافة الفعلية وحدها، بنفس
    // المنتج والكمية والسعر المعروضين للزبون.
    trackGaAddToCart({
      sku: product.sku,
      name: product.name_ar,
      price: effective.price,
      quantity,
      category: product.category_name_ar,
    });
    setAdded(true);
  }

  return (
    <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
      {variants.length > 0 && (
        <div className="mb-3">
          <span className="text-xs font-semibold text-neutral-700">
            اختر المقاس / النوع
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => handleVariantChange(variant.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  variant.id === selectedVariantId
                    ? "border-brand-turquoise bg-brand-turquoise-tint text-brand-turquoise-dark"
                    : "border-neutral-200 text-neutral-700 hover:border-brand-turquoise"
                }`}
              >
                {variant.variant_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-neutral-700">الكمية</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={outOfStock || quantity <= effective.minOrderQty}
            aria-label="إنقاص الكمية"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-lg font-bold text-neutral-700 disabled:opacity-40"
          >
            −
          </button>
          <span className="min-w-10 text-center text-sm font-semibold">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={outOfStock}
            aria-label="زيادة الكمية"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-lg font-bold text-neutral-700 disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        الكمية الدنيا {effective.minOrderQty} {product.unit_label}، بمضاعفات{" "}
        {effective.qtyIncrement}. المجموع الجزئي: {formatMad(effective.price * quantity)}
      </p>

      {outOfStock ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {product.status === "out_of_stock"
            ? "هذا المنتج غير متوفر للطلب حالياً."
            : "هذا المنتج غير متوفر حالياً في المخزون."}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleAddToCart}
            data-early-add={earlyAdd ? JSON.stringify(earlyAdd) : undefined}
            className="flex-1 rounded-full bg-brand-orange px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark"
          >
            {/* النص ثابت كما كان: بعد الترطيب يظهر زرّ «تمت الإضافة — عرض
                السلة» بجانبه، فتبديل نصّ هذا الزرّ أيضاً تكرارٌ وتغييرٌ
                للتصميم. الذي يبدّله مؤقتاً هو السكريبت المبكّر وحده، قبل
                الترطيب، حين لا يوجد أي زرّ آخر يؤكّد للزبون أن سلعته دخلت.
                suppressHydrationWarning لأن هذا التبديل قد يكون وقع فعلاً
                قبل وصول React — وهو المقصود لا خطأ. */}
            <span data-add-label suppressHydrationWarning>
              أضف إلى السلة
            </span>
          </button>
          {added && (
            <button
              type="button"
              onClick={() => router.push("/cart")}
              className="flex-1 rounded-full border border-brand-orange px-5 py-3 text-sm font-semibold text-brand-orange"
            >
              تمت الإضافة — عرض السلة
            </button>
          )}
        </div>
      )}
    </div>
  );
}
