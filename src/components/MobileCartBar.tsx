"use client";

import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { formatMad } from "@/lib/format";

/**
 * شريط ثابت أسفل الشاشة: قيمة السلة وزرّ يذهب مباشرة إلى إتمام الطلب.
 *
 * أغلب زبائننا على الهاتف وداخل متصفح فيسبوك، ولا أحد منهم يبحث عن أيقونة
 * سلة في الأعلى ولا يعرف معنى «Checkout». فبعد أول إضافة يظهر الطريق كاملاً
 * أمام إبهامه: كم في سلته، وأين يضغط ليُنهي.
 *
 * ويقفز مباشرة إلى /checkout لا إلى /cart: صفحة السلة تبقى متاحة لمن يريد
 * التعديل، لكنها لم تعد محطة إجبارية في الطريق.
 *
 * يُعرض قبل الترطيب أيضاً: البنية موجودة في HTML مخفيّة، والسكريبت المبكّر
 * (lib/cart/earlyAdd.ts) يملؤها ويُظهرها فور أول ضغطة — فلا ينتظر الزبون
 * وصول React ليرى أن سلعته دخلت السلة.
 */
export function MobileCartBar() {
  const { itemCount, subtotal, isHydrated } = useCart();
  const empty = itemCount === 0;

  return (
    <div
      data-cart-bar
      hidden={empty}
      suppressHydrationWarning
      className="fixed inset-x-0 bottom-0 z-50 border-t border-brand-orange/30 bg-white/95 px-3 py-2 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden"
    >
      <div className="flex items-center gap-3">
        <Link
          href="/cart"
          className="min-w-0 flex-1 leading-tight"
          aria-label="عرض السلة وتعديلها"
        >
          <span className="block text-[11px] text-neutral-500">
            السلة (<span data-cart-bar-count suppressHydrationWarning>{itemCount}</span>)
          </span>
          <span
            data-cart-bar-total
            suppressHydrationWarning
            className="block truncate text-base font-bold text-brand-orange"
          >
            {isHydrated ? formatMad(subtotal) : ""}
          </span>
        </Link>
        <Link
          href="/checkout"
          className="flex min-h-12 shrink-0 items-center justify-center rounded-full bg-brand-orange px-6 text-base font-bold text-white"
        >
          إتمام الطلب
        </Link>
      </div>
    </div>
  );
}
