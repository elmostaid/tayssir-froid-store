"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { cartItemKey, meetsMinimumOrder, snapQuantity } from "@/lib/cart/cartMath";
import { resolveImageUrl } from "@/lib/images";
import { formatMad } from "@/lib/format";

export function CartPageClient({ minOrderAmountMad }: { minOrderAmountMad: number }) {
  const { items, subtotal, updateQuantity, removeItem, isHydrated } = useCart();

  if (!isHydrated) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-neutral-500">جارٍ تحميل السلة…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-lg font-bold text-neutral-800">سلتك فارغة</h1>
        <p className="mt-2 text-sm text-neutral-600">
          تصفَّح منتجاتنا وأضف ما تحتاجه إلى السلة.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-full bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white"
        >
          العودة إلى الرئيسية
        </Link>
      </div>
    );
  }

  const meetsMinimum = meetsMinimumOrder(subtotal, minOrderAmountMad);
  const remaining = Math.max(0, minOrderAmountMad - subtotal);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        السلة
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
                    className="object-contain"
                    unoptimized
                  />
                ) : null}
              </div>

              <div className="flex flex-1 flex-col">
                <Link
                  href={`/product/${item.slug}`}
                  className="text-sm font-semibold text-neutral-800 hover:text-brand-turquoise-dark"
                >
                  {item.name}
                  {item.variantName && (
                    <span className="text-neutral-500"> — {item.variantName}</span>
                  )}
                </Link>
                <span className="mt-0.5 text-xs text-neutral-500">{item.sku}</span>
                <span className="mt-1 text-sm text-neutral-600">
                  {formatMad(item.unitPrice)} × {item.quantity} ={" "}
                  <span className="font-bold text-brand-orange">
                    {formatMad(item.unitPrice * item.quantity)}
                  </span>
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
        <p className="mt-1 text-xs text-neutral-500">
          هذا المجموع لا يشمل مصاريف التوصيل، والتي تُحسب لاحقاً حسب عدد
          الكرطونات بعد تجهيز الطلب.
        </p>

        {!meetsMinimum && (
          <div className="mt-3">
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              باقي لك {formatMad(remaining)} باش توصل لأقل قيمة للطلب (
              {formatMad(minOrderAmountMad)}).
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full rounded-full bg-brand-orange transition-[width]"
                style={{
                  width: `${Math.min(100, (subtotal / minOrderAmountMad) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          {meetsMinimum ? (
            <Link
              href="/checkout"
              className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-brand-orange px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark"
            >
              إتمام الطلب
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="flex min-h-11 flex-1 cursor-not-allowed items-center justify-center rounded-full bg-neutral-300 px-5 text-sm font-semibold text-white"
            >
              إتمام الطلب
            </button>
          )}
          <Link
            href="/"
            className="flex min-h-11 flex-1 items-center justify-center rounded-full border border-neutral-300 px-5 text-sm font-semibold text-neutral-700 hover:border-brand-turquoise hover:text-brand-turquoise-dark"
          >
            متابعة التسوق
          </Link>
        </div>
      </div>
    </div>
  );
}
