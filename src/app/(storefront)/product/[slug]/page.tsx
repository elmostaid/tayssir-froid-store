import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProductBySlug,
  getProductImages,
  getProductVariants,
} from "@/lib/queries/catalog";
import { getSettings } from "@/lib/queries/settings";
import { resolveImageUrl } from "@/lib/images";
import { formatMad } from "@/lib/format";
import { buildProductWhatsAppLink } from "@/lib/whatsapp";
import { safeQuery } from "@/lib/safeQuery";
import { AddToCartForm } from "@/components/AddToCartForm";
import { ServiceUnavailable } from "@/components/ServiceUnavailable";
import { getSiteUrl } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await safeQuery(
    () => getProductBySlug(slug),
    null,
    "product.generateMetadata"
  );
  if (!product) return {};

  const title = product.meta_title ?? product.name_ar;
  const description = product.meta_description ?? product.description_ar ?? undefined;
  const siteUrl = getSiteUrl();
  const path = `/product/${product.slug}`;
  const imageUrl = product.primary_image_path ? resolveImageUrl(product.primary_image_path) : undefined;

  return {
    title,
    description,
    alternates: siteUrl ? { canonical: path } : undefined,
    openGraph: {
      title,
      description,
      url: siteUrl ? path : undefined,
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;

  let product: Awaited<ReturnType<typeof getProductBySlug>>;
  try {
    product = await getProductBySlug(slug);
  } catch (error) {
    console.error("ProductPage: تعذّر الاتصال بقاعدة البيانات", error);
    return <ServiceUnavailable />;
  }

  if (!product) {
    notFound();
  }

  const [images, variants, settings] = await Promise.all([
    safeQuery(() => getProductImages(product.id), [], "product.getProductImages"),
    safeQuery(() => getProductVariants(product.id), [], "product.getProductVariants"),
    safeQuery(
      () => getSettings(),
      { minOrderAmountMad: 1000, deliveryFeePerCartonMad: 45, whatsappNumber: "+212722083458", storeCity: "" },
      "product.getSettings"
    ),
  ]);

  const mainImage = images[0];
  const whatsappLink = buildProductWhatsAppLink(product.name_ar, product.sku);
  const isUnavailable = product.status === "out_of_stock" || product.stock_quantity <= 0;
  const statusLabel =
    product.status === "out_of_stock"
      ? "غير متوفر للطلب"
      : product.stock_quantity <= 0
        ? "نفدت الكمية"
        : "متوفر";

  const siteUrl = getSiteUrl();
  // بيانات Product/Offer الحقيقية فقط (السعر والتوفر الفعليان من قاعدة
  // البيانات نفسها) — بدون أي Reviews أو Ratings وهمية.
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name_ar,
    sku: product.sku,
    ...(mainImage ? { image: [resolveImageUrl(mainImage.storage_path)] } : {}),
    ...(product.description_ar ? { description: product.description_ar } : {}),
    offers: {
      "@type": "Offer",
      priceCurrency: "MAD",
      price: product.sale_price,
      availability: isUnavailable
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
      ...(siteUrl ? { url: `${siteUrl}/product/${product.slug}` } : {}),
    },
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <nav className="text-xs text-neutral-500">
        <Link href="/" className="hover:underline">
          الرئيسية
        </Link>
        {" / "}
        <Link
          href={`/category/${product.category_slug}`}
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
                className="object-contain"
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
                    className="object-contain"
                    loading="lazy"
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

          <AddToCartForm
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

          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-whatsapp px-5 py-3 text-sm font-semibold text-whatsapp-dark transition-colors hover:bg-whatsapp hover:text-white"
          >
            استفسار عبر واتساب
          </a>

          <ul className="mt-4 flex flex-col gap-1.5 rounded-xl bg-neutral-100 p-4 text-xs text-neutral-600">
            <li>البيع بالجملة فقط</li>
            <li>أقل طلب إجمالي {formatMad(settings.minOrderAmountMad)}</li>
            <li>الدفع عند الاستلام بعد معاينة السلعة</li>
            <li>التوصيل لجميع مدن المغرب</li>
            <li>
              التوصيل {formatMad(settings.deliveryFeePerCartonMad)} للكرطونة
              (يُحدَّد عدد الكرطونات بعد تجهيز الطلب)
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
