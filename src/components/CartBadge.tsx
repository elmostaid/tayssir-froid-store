"use client";

import Link from "next/link";
import { useCart } from "@/components/CartProvider";

export function CartBadge() {
  const { itemCount } = useCart();

  return (
    <Link
      href="/cart"
      aria-label="السلة"
      className="relative inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-brand-turquoise hover:text-brand-turquoise-dark"
    >
      السلة
      {/*
        العدّاد موجود دائماً في HTML ومخفيّ حين يكون صفراً، بدل أن يُركَّب
        عند أول إضافة. السبب: السكريبت المبكّر (lib/cart/earlyAdd.ts) يحدّث
        هذا العنصر مباشرة قبل وصول React، ولا يستطيع إنشاء عنصر غير موجود.
        `hidden` يكفي للإخفاء: preflight يعطيه display:none !important، فلا
        يغلبه inline-flex. و suppressHydrationWarning لأن العدد قد يكون
        تغيّر فعلاً قبل الترطيب — وهذا هو المقصود لا خطأ.
      */}
      <span
        data-cart-count
        hidden={itemCount === 0}
        suppressHydrationWarning
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-orange px-1 text-xs font-semibold text-white"
      >
        {itemCount}
      </span>
    </Link>
  );
}
