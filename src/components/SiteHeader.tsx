import Link from "next/link";
import { getFilteredCategories } from "@/lib/queries/catalog";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { ProductImage } from "@/components/ProductImage";
import { THUMB_WIDTHS } from "@/lib/images/variants";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { CartBadge } from "@/components/CartBadge";
import { HeaderWhatsAppButton } from "@/components/HeaderWhatsAppButton";
import { MobileNav } from "@/components/MobileNav";

export async function SiteHeader() {
  // نفس القائمة المُصفَّاة بالضبط تُستعمل هنا لكل من قائمة الحاسوب (أسفل)
  // وقائمة الهاتف (MobileNav) — مصدر واحد مشترك، لا فرق بين الاثنين أبداً.
  const [categories, settings] = await Promise.all([
    getFilteredCategories("SiteHeader.getCategories"),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "SiteHeader.getSettings"),
  ]);

  const whatsappLink = buildWhatsAppLink(
    settings.whatsappNumber,
    `مرحباً، عندي سؤال بخصوص منتجات ${settings.storeName}.`
  );

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      {/* الحشو والفواصل أضيق على الهاتف وحده (قيم الحاسوب محفوظة خلف sm:):
          القياس على متصفّح حقيقي أثبت أن مجموع عناصر الترويسة كان يفوق عرض
          شاشة 360px فيُسحق الشعار (إلى 31px على 320px). هذه البكسلات
          المُحرَّرة هي ما يجعل نصّي «لإتمام الطلب» و«استفسار» يُضافان بلا
          أن يخسر الشعار أو البحث أو القائمة شيئاً. */}
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
        <MobileNav categories={categories} whatsappLink={whatsappLink} />

        <Link href="/" className="flex min-w-0 flex-col items-start gap-0.5">
          {/*
           * الشعار يظهر فوق الطيّة في **كل** صفحة، وأصله PNG بعرض 600
           * (33 KB) يُعرض بارتفاع 32–36px أي ~101 CSS px عرضاً. نسخة 360
           * WebP تكفي كثافة 3× بـ~7 KB، والأصل يبقى احتياطاً كبقية الصور.
           */}
          <ProductImage
            storagePath="brand/logo-tayssir-froid.png"
            resolvedSrc="/brand/logo-tayssir-froid.png"
            alt="Tayssir Froid"
            widths={THUMB_WIDTHS}
            sizes="101px"
            width={169}
            height={60}
            priority
            /*
             * object-contain لا تجميل: الشعار عنصرٌ مرن في صفّ الترويسة،
             * فعلى الشاشات الضيّقة جداً (320px) يُضغط عرضه — وبلا
             * object-contain يُمدَّد محتواه فيخرج الشعار **مشوَّهاً**. الآن
             * يصغر بنسبته محفوظة بدل أن ينشوّه.
             */
            className="h-8 w-auto object-contain sm:h-9"
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
            className="w-full max-w-md rounded-full border border-neutral-300 px-4 py-2 text-base focus:border-brand-turquoise focus:outline-none focus:ring-2 focus:ring-brand-turquoise/30"
          />
        </form>

        <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link
            href="/search"
            aria-label="البحث"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 md:hidden"
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
          {/* الاستفسار، لا إتمام الطلب — ويغيب في /checkout. التفاصيل في
              components/HeaderWhatsAppButton.tsx. */}
          <HeaderWhatsAppButton href={whatsappLink} />
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
