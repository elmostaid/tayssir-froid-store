import type { Metadata } from "next";
import { searchProducts, getProductIdsWithVariants } from "@/lib/queries/catalog";
import { ProductCard } from "@/components/ProductCard";
import { safeQuery } from "@/lib/safeQuery";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  return {
    title: query ? `نتائج البحث عن "${query}"` : "البحث",
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const [products, variantProductIds, settings] = await Promise.all([
    query
      ? safeQuery(() => searchProducts(query), [], "search.searchProducts")
      : Promise.resolve([]),
    safeQuery(() => getProductIdsWithVariants(), new Set<number>(), "search.getProductIdsWithVariants"),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "search.getSettings"),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        نتائج البحث
      </h1>

      <form action="/search" method="GET" className="mt-4 flex max-w-lg gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="قلب على اسم القطعة أو الكود"
          aria-label="ابحث عن اسم القطعة أو الكود"
          className="w-full rounded-full border border-neutral-300 px-4 py-2.5 text-base focus:border-brand-turquoise focus:outline-none focus:ring-2 focus:ring-brand-turquoise/30"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-brand-turquoise px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-turquoise-dark"
        >
          بحث
        </button>
      </form>

      {!query ? (
        <p className="mt-6 text-sm text-neutral-500">
          اكتب اسم القطعة أو الكود (SKU) أو الماركة في خانة البحث أعلاه.
        </p>
      ) : products.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">
          لا توجد نتائج مطابقة لـ &quot;{query}&quot;. جرّب كلمة أخرى أو تواصل
          معنا عبر واتساب.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-neutral-500">
            {products.length} نتيجة لـ &quot;{query}&quot;
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                imageUrl={product.primary_image_path}
                hasVariants={variantProductIds.has(product.id)}
                whatsappNumber={settings.whatsappNumber}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
