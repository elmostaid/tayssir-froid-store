import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CartProvider } from "@/components/CartProvider";

export const metadata: Metadata = {
  title: {
    default: "Tayssir Froid - قطع غيار التبريد بالجملة",
    template: "%s | Tayssir Froid",
  },
  description:
    "Tayssir Froid: بيع قطع غيار الغسالات والثلاجات والمجمدات والمكيفات بالجملة للتجار والصنايعية في المغرب.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <CartProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </CartProvider>
      </body>
    </html>
  );
}
