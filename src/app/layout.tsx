import type { Metadata } from "next";
import "./globals.css";
import { getSiteUrl, isProductionDeployment } from "@/lib/siteUrl";

const siteUrl = getSiteUrl();
const description =
  "Tayssir Froid: بيع قطع غيار الغسالات والثلاجات والمجمدات والمكيفات بالجملة للتجار والصنايعية في المغرب.";

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "Tayssir Froid - قطع غيار التبريد بالجملة",
    template: "%s | Tayssir Froid",
  },
  description,
  openGraph: {
    type: "website",
    siteName: "Tayssir Froid",
    title: "Tayssir Froid - قطع غيار التبريد بالجملة",
    description,
    locale: "ar_MA",
  },
  twitter: {
    card: "summary",
    title: "Tayssir Froid - قطع غيار التبريد بالجملة",
    description,
  },
  // خط دفاع إضافي فوق app/robots.ts: يمنع الفهرسة صراحةً في أي بيئة ليست
  // نشر Vercel Production الحقيقي (نسخة المعاينة، التطوير المحلي...).
  robots: isProductionDeployment()
    ? { index: true, follow: true }
    : { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {children}
      </body>
    </html>
  );
}
