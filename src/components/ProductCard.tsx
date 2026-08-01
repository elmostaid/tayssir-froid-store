import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/types";
import { resolveImageUrl } from "@/lib/images";
import { formatMad } from "@/lib/format";
import { ProductCardActions } from "@/components/ProductCardActions";

export function ProductCard({
  product,
  imageUrl,
  hasVariants = false,
}: {
  product: CatalogProduct;
  imageUrl: string | null;
  hasVariants?: boolean;
}) {
  const isUnavailable = product.status === "out_of_stock" || product.stock_quantity <= 0;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition-shadow hover:shadow-md">
      <Link
        href={`/product/${product.slug}`}
        className="group relative block aspect-square w-full bg-neutral-100"
      >
        {imageUrl ? (
          <Image
            src={resolveImageUrl(imageUrl)}
            alt={product.name_ar}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 220px"
            className="object-contain object-center transition-transform group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
            بدون صورة
          </div>
        )}
        {isUnavailable && (
          <span className="absolute right-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
            غير متوفر
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="text-xs font-medium text-brand-turquoise-dark">
          {product.category_name_ar}
        </span>
        <Link href={`/product/${product.slug}`}>
          <h3 className="line-clamp-2 min-h-[2.5em] text-sm font-semibold text-neutral-800 hover:text-brand-turquoise-dark">
            {product.name_ar}
          </h3>
        </Link>
        <span className="text-[11px] text-neutral-400">{product.sku}</span>
        <span className="mt-auto text-base font-bold text-brand-orange">
          {formatMad(product.sale_price)}
          <span className="text-xs font-normal text-neutral-500"> / {product.unit_label}</span>
        </span>
        <span className="text-xs text-neutral-500">
          الكمية الدنيا: {product.min_order_qty} {product.unit_label}
        </span>

        <ProductCardActions product={product} imageUrl={imageUrl} hasVariants={hasVariants} />
      </div>
    </div>
  );
}
