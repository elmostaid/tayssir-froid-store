import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/types";
import { resolveImageUrl } from "@/lib/images";
import { formatMad } from "@/lib/format";

export function ProductCard({
  product,
  imageUrl,
}: {
  product: CatalogProduct;
  imageUrl: string | null;
}) {
  return (
    <Link
      href={`/product/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-square w-full bg-neutral-100">
        {imageUrl ? (
          <Image
            src={resolveImageUrl(imageUrl)}
            alt={product.name_ar}
            fill
            sizes="(max-width: 640px) 50vw, 220px"
            className="object-contain"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
            بدون صورة
          </div>
        )}
        {(product.status === "out_of_stock" || product.stock_quantity <= 0) && (
          <span className="absolute right-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
            غير متوفر
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="text-xs font-medium text-brand-turquoise-dark">
          {product.category_name_ar}
        </span>
        <h3 className="line-clamp-2 text-sm font-semibold text-neutral-800 group-hover:text-brand-turquoise-dark">
          {product.name_ar}
        </h3>
        <span className="mt-auto text-base font-bold text-brand-orange">
          {formatMad(product.sale_price)}
        </span>
        <span className="text-xs text-neutral-500">
          الكمية الدنيا: {product.min_order_qty} {product.unit_label}
        </span>
      </div>
    </Link>
  );
}
