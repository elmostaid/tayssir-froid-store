import Link from "next/link";
import { getCategories, getProducts } from "@/lib/queries/catalog";
import { ProductCard } from "@/components/ProductCard";
import { buildWhatsAppLink } from "@/lib/whatsapp";

// تُعرض هذه الصفحة ديناميكياً عند كل طلب (وليس عند البناء) لأن بيانات
// المنتجات والأسعار تأتي من قاعدة البيانات ويجب أن تكون محدَّثة دائماً.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [categories, products] = await Promise.all([
    getCategories(),
    getProducts({ limit: 12 }),
  ]);

  const whatsappLink = buildWhatsAppLink(
    "مرحباً، أريد الاطلاع على منتجاتكم بالجملة."
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <section className="rounded-2xl bg-brand-dark px-5 py-8 text-white">
        <h1 className="text-2xl font-bold sm:text-3xl">
          Tayssir Froid — قطع غيار التبريد بالجملة
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-white/90 sm:text-base">
          قطع غيار الغسالات والثلاجات والمجمدات والمكيفات، للتجار والصنايعية
          ومحلات قطع الغيار في المغرب. البيع بالجملة فقط، الحد الأدنى للطلبية
          1000 درهم، والدفع عند الاستلام.
        </p>
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white"
        >
          تواصل معنا عبر واتساب
        </a>
      </section>

      {categories.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-neutral-800">التصنيفات</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                className="rounded-xl border border-neutral-200 bg-white p-4 text-center text-sm font-medium text-neutral-700 hover:border-brand hover:text-brand-dark"
              >
                {category.name_ar}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-bold text-neutral-800">أحدث المنتجات</h2>
        {products.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            لا توجد منتجات منشورة بعد.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                imageUrl={product.primary_image_path}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
