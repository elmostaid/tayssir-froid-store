import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPreviewProductBySlug,
  getPreviewProductImages,
  getPreviewProductVariants,
} from "@/lib/previewCatalog";
import { resolveImageUrl } from "@/lib/images";
import { formatMad } from "@/lib/format";
import { PreviewAddToCartForm } from "@/components/preview/PreviewAddToCartForm";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = getPreviewProductBySlug(slug);
  if (!product) return {};
  return {
    title: product.meta_title ?? product.name_ar,
    description: product.meta_description ?? product.description_ar ?? undefined,
  };
}

export default async function PreviewProductPage({ params }: Props) {
  const { slug } = await params;
  const product = getPreviewProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const images = getPreviewProductImages(product.id);
  const variants = getPreviewProductVariants(product.id);

  const mainImage = images[0];
  const isUnavailable = product.status === "out_of_stock" || product.stock_quantity <= 0;
  const statusLabel =
    product.status === "out_of_stock"
      ? "غير متوفر للطلب"
      : product.stock_quantity <= 0
        ? "نفدت الكمية"
        : "متوفر";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <nav className="text-xs text-neutral-500">
        <Link href="/preview" className="hover:underline">
          الرئيسية
        </Link>
        {" / "}
        <Link
          href={`/preview/category/${product.category_slug}`}
          className="hover:text-brand-turquoise-dark hover:underline"
        >
          {product.category_name_ar}
        </Link>
      </nav>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
            {mainImage ? (
              <Image
                src={resolveImageUrl(mainImage.storage_path)}
                alt={mainImage.alt_text_ar ?? product.name_ar}
                fill
                sizes="(max-width: 768px) 100vw, 500px"
                className="object-cover"
                unoptimized
                priority
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
                بدون صورة
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {images.slice(1).map((image) => (
                <div
                  key={image.id}
                  className="relative aspect-square overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
                >
                  <Image
                    src={resolveImageUrl(image.storage_path)}
                    alt={image.alt_text_ar ?? product.name_ar}
                    fill
                    sizes="120px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="text-xl font-bold text-neutral-900">{product.name_ar}</h1>
          <p className="mt-1 text-xs text-neutral-500">
            SKU: {product.sku}
            {product.name_fr && ` — ${product.name_fr}`}
          </p>

          <p className="mt-4 text-2xl font-bold text-brand-orange">
            {formatMad(product.sale_price)}
            <span className="text-sm font-normal text-neutral-500">
              {" "}
              / {product.unit_label}
            </span>
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-neutral-100 p-3">
              <dt className="text-neutral-500">الكمية الدنيا للطلب</dt>
              <dd className="font-semibold text-neutral-800">
                {product.min_order_qty} {product.unit_label}
              </dd>
            </div>
            <div className="rounded-lg bg-neutral-100 p-3">
              <dt className="text-neutral-500">درجة الزيادة</dt>
              <dd className="font-semibold text-neutral-800">
                مضاعفات {product.qty_increment}
              </dd>
            </div>
            <div className="rounded-lg bg-neutral-100 p-3">
              <dt className="text-neutral-500">الحالة</dt>
              <dd
                className={`font-semibold ${
                  isUnavailable ? "text-red-700" : "text-brand-turquoise-dark"
                }`}
              >
                {statusLabel}
              </dd>
            </div>
            <div className="rounded-lg bg-neutral-100 p-3">
              <dt className="text-neutral-500">المخزون</dt>
              <dd className="font-semibold text-neutral-800">
                {product.stock_quantity} {product.unit_label}
              </dd>
            </div>
          </dl>

          <PreviewAddToCartForm
            product={product}
            variants={variants}
            imageUrl={mainImage?.storage_path ?? null}
          />

          {product.description_ar && (
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-neutral-800">الوصف</h2>
              <p className="mt-1 text-sm text-neutral-600 whitespace-pre-line">
                {product.description_ar}
              </p>
            </div>
          )}

          {product.technical_specs && (
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-neutral-800">
                المواصفات التقنية
              </h2>
              <p className="mt-1 text-sm text-neutral-600 whitespace-pre-line">
                {product.technical_specs}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
