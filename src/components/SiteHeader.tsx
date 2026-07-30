import Image from "next/image";
import Link from "next/link";
import { getCategories } from "@/lib/queries/catalog";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export async function SiteHeader() {
  let categories: Awaited<ReturnType<typeof getCategories>> = [];
  try {
    categories = await getCategories();
  } catch (error) {
    // نسجّل الخطأ في سجلات الخادم فقط للمطور. لا نعرض أي تفاصيل تقنية
    // للزائر؛ الموقع يستمر في العمل والرأس يُعرض بدون قائمة التصنيفات.
    console.error("SiteHeader: تعذّر جلب التصنيفات من قاعدة البيانات", error);
  }

  const whatsappLink = buildWhatsAppLink(
    "مرحباً، عندي سؤال بخصوص منتجات Tayssir Froid."
  );

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex flex-col items-start gap-1">
          <Image
            src="/brand/logo-tayssir-froid.png"
            alt="Tayssir Froid"
            width={169}
            height={60}
            priority
            className="h-9 w-auto sm:h-10"
          />
          <span className="text-[11px] text-neutral-500">
            قطع غيار التبريد بالجملة — مراكش
          </span>
        </Link>

        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-whatsapp px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-whatsapp-dark active:scale-95"
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
