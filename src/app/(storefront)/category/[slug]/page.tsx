import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getCategoryBySlug,
  getProductIdsWithVariants,
  getProducts,
  type ProductSort,
} from "@/lib/queries/catalog";
import { ProductCard } from "@/components/ProductCard";
import { safeQuery } from "@/lib/safeQuery";
import { ServiceUnavailable } from "@/components/ServiceUnavailable";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; sort?: string }>;
};

const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: "newest", label: "الأحدث" },
  { value: "price_asc", label: "الثمن: من الأقل للأعلى" },
  { value: "price_desc", label: "الثمن: من الأعلى للأقل" },
  { value: "name", label: "الاسم" },
];

function parseSort(value: string | undefined): ProductSort {
  return SORT_OPTIONS.some((option) => option.value === value)
    ? (value as ProductSort)
    : "newest";
}

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

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { q, sort: sortParam } = await searchParams;
  const query = (q ?? "").trim();
  const sort = parseSort(sortParam);

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

  const [products, variantProductIds] = await Promise.all([
    safeQuery(
      () => getProducts({ categorySlug: slug, limit: 100, query, sort }),
      [],
      "category.getProducts"
    ),
    safeQuery(() => getProductIdsWithVariants(), new Set<number>(), "category.getProductIdsWithVariants"),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        {category.name_ar}
      </h1>
      {category.description_ar && (
        <p className="mt-1 text-sm text-neutral-600">{category.description_ar}</p>
      )}

      <form
        action={`/category/${slug}`}
        method="GET"
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="ابحث داخل هذا التصنيف"
          aria-label="ابحث داخل هذا التصنيف"
          className="w-full rounded-full border border-neutral-300 px-4 py-2 text-sm focus:border-brand-turquoise focus:outline-none sm:max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <span className="shrink-0">ترتيب حسب</span>
          <select
            name="sort"
            defaultValue={sort}
            className="min-h-11 w-full rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none sm:w-auto"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 shrink-0 rounded-full bg-brand-turquoise px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-turquoise-dark"
        >
          تطبيق
        </button>
      </form>

      <p className="mt-3 text-sm text-neutral-500">
        {products.length} {products.length === 1 ? "منتج" : "منتجات"}
        {query && <> لـ &quot;{query}&quot;</>}
      </p>

      {products.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">
          {query
            ? `لا توجد نتائج مطابقة لـ "${query}" في هذا التصنيف.`
            : "لا توجد منتجات منشورة في هذا التصنيف حالياً."}
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              imageUrl={product.primary_image_path}
              hasVariants={variantProductIds.has(product.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
