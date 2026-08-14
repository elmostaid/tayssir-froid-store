import Image from "next/image";
import Link from "next/link";
import {
  getFilteredCategories,
  getProductCountsByCategory,
  getProductIdsWithVariants,
  getProducts,
} from "@/lib/queries/catalog";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { ProductCard } from "@/components/ProductCard";
import { CategoryIcon } from "@/components/CategoryIcon";
import { getCategoryImage } from "@/lib/categoryImages";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { safeQuery } from "@/lib/safeQuery";
import { formatMinOrderAmount } from "@/lib/format";

// تُعرض هذه الصفحة ديناميكياً عند كل طلب (وليس عند البناء) لأن بيانات
// المنتجات والأسعار تأتي من قاعدة البيانات ويجب أن تكون محدَّثة دائماً.
export const dynamic = "force-dynamic";

export function buildTrustPoints(minOrderAmountMad: number): string[] {
  return [
    `الحد الأدنى للطلب: ${formatMinOrderAmount(minOrderAmountMad)}`,
    "الدفع عند الاستلام بعد معاينة السلعة",
    "التوصيل لجميع مدن المغرب 24–48 ساعة",
    "كلما زادت الكمية، كينقص الثمن",
  ];
}

// ترتيب ثابت مطلوب لقسم التصنيفات فالصفحة الرئيسية: الثلاجات، ثم المكيفات
// سبليت، ثم الغسالات العادية. أي تصنيف آخر (لو ظهر مستقبلاً) يبقى بعدها
// بنفس ترتيبه الأصلي من getFilteredCategories.
const HOME_CATEGORY_ORDER = [
  "refrigerator-spare-parts",
  "split-ac-parts",
  "standard-washing-machine-parts",
];

function sortHomeCategories<T extends { slug: string }>(categories: T[]): T[] {
  return categories.slice().sort((a, b) => {
    const indexA = HOME_CATEGORY_ORDER.indexOf(a.slug);
    const indexB = HOME_CATEGORY_ORDER.indexOf(b.slug);
    const rankA = indexA === -1 ? HOME_CATEGORY_ORDER.length : indexA;
    const rankB = indexB === -1 ? HOME_CATEGORY_ORDER.length : indexB;
    return rankA - rankB;
  });
}

export default async function HomePage() {
  const [categoriesRaw, productCounts, products, variantProductIds, settings] = await Promise.all([
    getFilteredCategories("home.getCategories"),
    safeQuery(() => getProductCountsByCategory(), {}, "home.getProductCountsByCategory"),
    safeQuery(() => getProducts({ limit: 12 }), [], "home.getProducts"),
    safeQuery(() => getProductIdsWithVariants(), new Set<number>(), "home.getProductIdsWithVariants"),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "home.getSettings"),
  ]);

  const categories = sortHomeCategories(categoriesRaw);

  const whatsappLink = buildWhatsAppLink(
    settings.whatsappNumber,
    "مرحباً، أريد الاطلاع على منتجاتكم بالجملة."
  );
  const trustPoints = buildTrustPoints(settings.minOrderAmountMad);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <section className="rounded-2xl bg-brand-turquoise-tint px-5 py-8">
        <span className="inline-block rounded-full bg-brand-orange px-3 py-1 text-xs font-semibold text-white">
          البيع بالجملة فقط
        </span>
        <h1 className="mt-3 text-2xl font-bold text-neutral-900 sm:text-3xl">
          قطع الغيار بالجملة
        </h1>

        <ul className="mt-4 flex flex-col gap-1.5 text-sm text-neutral-700 sm:text-base">
          {trustPoints.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-turquoise" />
              {point}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <Link
            href="#categories"
            className="flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark"
          >
            تصفح المنتجات
          </Link>
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-whatsapp px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-whatsapp-dark"
          >
            محتاج مساعدة؟ طلب عبر واتساب
          </a>
        </div>

        <p className="mt-3 text-xs text-neutral-600 sm:text-sm">
          طريقة الطلب: اختار القطع ← زيدها للسلة ← صيفط الطلب فالواتساب
        </p>
      </section>

      {categories.length > 0 && (
        <section id="categories" className="mt-8 scroll-mt-20">
          <h2 className="border-r-4 border-brand-turquoise pr-3 text-lg font-bold text-neutral-800">
            التصنيفات
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-3">
            {categories.map((category) => {
              const count = productCounts[category.id] ?? 0;
              const imageSrc = getCategoryImage(category.slug);
              return (
                <Link
                  key={category.id}
                  href={`/category/${category.slug}`}
                  className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition-colors hover:border-brand-turquoise"
                >
                  <span className="relative block aspect-[4/5] w-full bg-neutral-50">
                    {imageSrc ? (
                      // الصورة نفسها تحتوي على اسم التصنيف مطبوعاً فأسفلها
                      // (مصمَّمة هكذا مسبقاً) — لا نكرّر الاسم فنص HTML فوقها
                      // تفادياً للتكرار البصري، ونكتفي بعدد المنتجات تحتها.
                      <Image
                        src={imageSrc}
                        alt={category.name_ar}
                        fill
                        sizes="(max-width: 1152px) 100vw, 1120px"
                        className="object-contain object-center p-2"
                        priority
                      />
                    ) : (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-turquoise-tint text-brand-turquoise-dark">
                          <CategoryIcon slug={category.slug} name={category.name_ar} className="h-7 w-7" />
                        </span>
                        <span className="line-clamp-2 text-center text-sm font-semibold text-neutral-800">
                          {category.name_ar}
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="px-3 py-2 text-center text-xs text-neutral-500">
                    {count} {count === 1 ? "منتج" : "منتجات"}
                  </span>
                </Link>
              );
            })}
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
              <ProductCard
                key={product.id}
                product={product}
                imageUrl={product.primary_image_path}
                hasVariants={variantProductIds.has(product.id)}
                whatsappNumber={settings.whatsappNumber}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
