import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCategoryBySlug, getProducts } from "@/lib/queries/catalog";
import { ProductCard } from "@/components/ProductCard";
import { safeQuery } from "@/lib/safeQuery";
import { ServiceUnavailable } from "@/components/ServiceUnavailable";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await safeQuery(
    () => getCategoryBySlug(slug),
    null,
    "category.generateMetadata"
  );
  if (!category) return {};
  return {
    title: category.name_ar,
    description:
      category.description_ar ??
      `منتجات ${category.name_ar} بالجملة من Tayssir Froid`,
  };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;

  let category: Awaited<ReturnType<typeof getCategoryBySlug>>;
  try {
    category = await getCategoryBySlug(slug);
  } catch (error) {
    console.error("CategoryPage: تعذّر الاتصال بقاعدة البيانات", error);
    return <ServiceUnavailable />;
  }

  if (!category) {
    notFound();
  }

  const products = await safeQuery(
    () => getProducts({ categorySlug: slug, limit: 100 }),
    [],
    "category.getProducts"
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        {category.name_ar}
      </h1>
      {category.description_ar && (
        <p className="mt-1 text-sm text-neutral-600">{category.description_ar}</p>
      )}

      {products.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">
          لا توجد منتجات منشورة في هذا التصنيف حالياً.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              imageUrl={product.primary_image_path}
            />
          ))}
        </div>
      )}
    </div>
  );
}
