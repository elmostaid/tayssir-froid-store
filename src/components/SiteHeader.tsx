import Image from "next/image";
import Link from "next/link";
import { getCategories } from "@/lib/queries/catalog";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { safeQuery } from "@/lib/safeQuery";
import { CartBadge } from "@/components/CartBadge";
import { MobileNav } from "@/components/MobileNav";

export async function SiteHeader() {
  // لا نثق بتوفّر قاعدة البيانات دائماً: إن تعذّر الجلب، يستمر الموقع
  // بالعمل والرأس يُعرض بدون قائمة التصنيفات بدل انهيار الصفحة بالكامل.
  const categories = await safeQuery(
    () => getCategories(),
    [],
    "SiteHeader.getCategories"
  );

  const whatsappLink = buildWhatsAppLink(
    "مرحباً، عندي سؤال بخصوص منتجات Tayssir Froid."
  );

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <MobileNav categories={categories} whatsappLink={whatsappLink} />

        <Link href="/" className="flex min-w-0 flex-col items-start gap-0.5">
          <Image
            src="/brand/logo-tayssir-froid.png"
            alt="Tayssir Froid"
            width={169}
            height={60}
            priority
            className="h-8 w-auto sm:h-9"
          />
          <span className="hidden text-[11px] text-neutral-500 sm:block">
            قطع غيار التبريد بالجملة — مراكش
          </span>
        </Link>

        <form
          action="/search"
          method="GET"
          className="mx-2 hidden min-w-0 flex-1 md:flex"
        >
          <input
            type="search"
            name="q"
            placeholder="قلب على اسم القطعة أو الكود"
            aria-label="ابحث عن اسم القطعة أو الكود"
            className="w-full max-w-md rounded-full border border-neutral-300 px-4 py-2 text-sm focus:border-brand-turquoise focus:outline-none focus:ring-2 focus:ring-brand-turquoise/30"
          />
        </form>

        <div className="ms-auto flex shrink-0 items-center gap-2">
          <Link
            href="/search"
            aria-label="البحث"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth={2} />
              <path
                d="m20 20-3.2-3.2"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
          </Link>
          <CartBadge />
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="تواصل عبر واتساب"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-whatsapp text-white shadow-sm transition-colors hover:bg-whatsapp-dark active:scale-95 sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 sm:hidden" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.11-1.34A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Zm0 18c-1.6 0-3.1-.43-4.4-1.19l-.32-.19-3.03.8.81-2.95-.2-.3A7.95 7.95 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8Zm4.4-5.9c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.44-1.34-1.68-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
            </svg>
            <span className="hidden sm:inline">واتساب</span>
          </a>
        </div>
      </div>

      {categories.length > 0 && (
        <nav
          aria-label="التصنيفات"
          className="mx-auto hidden max-w-6xl gap-2 overflow-x-auto px-4 pb-3 text-sm md:flex"
        >
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 transition-colors hover:border-brand-turquoise hover:text-brand-turquoise-dark"
            >
              {category.name_ar}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
