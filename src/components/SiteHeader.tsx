import Link from "next/link";
import { getCategories } from "@/lib/queries/catalog";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export async function SiteHeader() {
  const categories = await getCategories();
  const whatsappLink = buildWhatsAppLink(
    "مرحباً، عندي سؤال بخصوص منتجات Tayssir Froid."
  );

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex flex-col leading-tight">
          <span className="text-lg font-bold text-brand-dark">
            Tayssir Froid
          </span>
          <span className="text-xs text-neutral-500">
            قطع غيار التبريد بالجملة — مراكش
          </span>
        </Link>

        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm active:scale-95"
        >
          واتساب
        </a>
      </div>

      {categories.length > 0 && (
        <nav
          aria-label="التصنيفات"
          className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3 text-sm"
        >
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:border-brand hover:text-brand-dark"
            >
              {category.name_ar}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
