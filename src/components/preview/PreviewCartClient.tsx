"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { cartItemKey, snapQuantity } from "@/lib/cart/cartMath";
import { resolveImageUrl } from "@/lib/images";
import { formatMad } from "@/lib/format";

// سلة محلية فقط لمعاينة الموقع: لا اتصال بقاعدة البيانات ولا صفحة إتمام
// طلب هنا — فقط عرض وتعديل محتوى السلة المخزَّن في المتصفح.
export function PreviewCartClient() {
  const { items, subtotal, updateQuantity, removeItem, isHydrated } = useCart();

  if (!isHydrated) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-neutral-500">
        جارٍ تحميل السلة…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-lg font-bold text-neutral-800">سلتك فارغة</h1>
        <p className="mt-2 text-sm text-neutral-600">
          تصفَّح المنتجات وأضف ما يهمك إلى السلة.
        </p>
        <Link
          href="/preview"
          className="mt-4 inline-block rounded-full bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white"
        >
          العودة إلى المعاينة
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        السلة (معاينة محلية)
      </h1>

      <ul className="mt-4 flex flex-col gap-3">
        {items.map((item) => {
          const key = cartItemKey(item.productId, item.variantId);
          return (
            <li
              key={key}
              className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3"
            >
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
                {item.imageUrl ? (
                  <Image
                    src={resolveImageUrl(item.imageUrl)}
                    alt={item.name}
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                  />
                ) : null}
              </div>

              <div className="flex flex-1 flex-col">
                <Link
                  href={`/preview/product/${item.slug}`}
                  className="text-sm font-semibold text-neutral-800 hover:text-brand-turquoise-dark"
                >
                  {item.name}
                  {item.variantName && (
                    <span className="text-neutral-500"> — {item.variantName}</span>
                  )}
                </Link>
                <span className="mt-0.5 text-xs text-neutral-500">{item.sku}</span>
                <span className="mt-1 text-sm font-bold text-brand-orange">
                  {formatMad(item.unitPrice)}
                </span>

                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="إنقاص الكمية"
                      onClick={() =>
                        updateQuantity(
                          item.productId,
                          item.variantId,
                          Math.max(
                            item.minOrderQty,
                            snapQuantity(
                              item.quantity - item.qtyIncrement,
                              item.minOrderQty,
                              item.qtyIncrement
                            )
                          )
                        )
                      }
                      disabled={item.quantity <= item.minOrderQty}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 text-base font-bold disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="min-w-8 text-center text-sm font-semibold">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="زيادة الكمية"
                      onClick={() =>
                        updateQuantity(
                          item.productId,
                          item.variantId,
                          item.quantity + item.qtyIncrement
                        )
                      }
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 text-base font-bold"
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(item.productId, item.variantId)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    حذف
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-600">مجموع المنتجات</span>
          <span className="text-lg font-bold text-neutral-900">{formatMad(subtotal)}</span>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          هذه معاينة محلية فقط داخل المتصفح — لا يوجد إتمام طلب هنا.
        </p>
      </div>
    </div>
  );
}
