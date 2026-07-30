import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCategoryBySlug, getProducts } from "@/lib/queries/catalog";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
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
  const category = await getCategoryBySlug(slug);

  if (!category) {
    notFound();
  }

  const products = await getProducts({ categorySlug: slug, limit: 100 });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-xl font-bold text-neutral-800">{category.name_ar}</h1>
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
