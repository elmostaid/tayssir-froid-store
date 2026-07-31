import Link from "next/link";
import { getPreviewCategories, getPreviewProducts } from "@/lib/previewCatalog";
import { PreviewProductCard } from "@/components/preview/PreviewProductCard";

export const metadata = {
  title: "معاينة",
};

export default function PreviewHomePage() {
  const categories = getPreviewCategories();
  const products = getPreviewProducts({ limit: 12 });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <section className="rounded-2xl bg-brand-turquoise-tint px-5 py-8">
        <span className="inline-block rounded-full bg-brand-orange px-3 py-1 text-xs font-semibold text-white">
          البيع بالجملة فقط
        </span>
        <h1 className="mt-3 text-2xl font-bold text-neutral-900 sm:text-3xl">
          Tayssir Froid — قطع غيار التبريد بالجملة
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-700 sm:text-base">
          نسخة معاينة للموقع باستعمال بيانات المنتجات والصور الموجودة حالياً
          في المشروع.
        </p>
      </section>

      {categories.length > 0 && (
        <section className="mt-8">
          <h2 className="border-r-4 border-brand-turquoise pr-3 text-lg font-bold text-neutral-800">
            التصنيفات
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/preview/category/${category.slug}`}
                className="rounded-xl border border-neutral-200 bg-white p-4 text-center text-sm font-medium text-neutral-700 transition-colors hover:border-brand-turquoise hover:text-brand-turquoise-dark"
              >
                {category.name_ar}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="border-r-4 border-brand-turquoise pr-3 text-lg font-bold text-neutral-800">
          أحدث المنتجات
        </h2>
        {products.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            لا توجد منتجات منشورة بعد.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {products.map((product) => (
              <PreviewProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
