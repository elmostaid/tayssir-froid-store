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
      {itemCount > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-orange px-1 text-xs font-semibold text-white">
          {itemCount}
        </span>
      )}
    </Link>
  );
}
