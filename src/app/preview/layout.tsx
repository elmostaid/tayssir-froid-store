import Image from "next/image";
import Link from "next/link";
import { CartProvider } from "@/components/CartProvider";
import { PreviewCartBadge } from "@/components/preview/PreviewCartBadge";

// طبقة عرض مستقلة تماماً عن قاعدة البيانات: بدون SiteHeader/SiteFooter
// الحقيقيين (يعتمدان على قاعدة البيانات)، فقط رأس وتذييل ثابتان لمعاينة
// الموقع ببيانات المنتجات والصور الموجودة محلياً في المشروع.
export default function PreviewLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CartProvider>
      <div className="flex min-h-full flex-1 flex-col">
        <div className="bg-brand-orange px-4 py-1.5 text-center text-xs font-semibold text-white">
          نسخة معاينة — بيانات محلية، بدون اتصال بقاعدة البيانات
        </div>

        <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/preview" className="flex flex-col items-start gap-1">
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

            <PreviewCartBadge />
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-neutral-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-neutral-600">
            <div className="flex items-center gap-2">
              <Image
                src="/brand/icon-snowflake.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7"
              />
              <span className="font-semibold text-neutral-800">Tayssir Froid</span>
            </div>
            <p className="mt-3">
              بيع قطع غيار الغسالات والثلاجات والمجمدات والمكيفات بالجملة —
              للتجار والصنايعية ومحلات قطع الغيار.
            </p>
          </div>
        </footer>
      </div>
    </CartProvider>
  );
}
