import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CartProvider } from "@/components/CartProvider";
import { AnalyticsClient } from "@/components/AnalyticsClient";
import { MobileCartBar } from "@/components/MobileCartBar";
import { EARLY_ADD_SCRIPT } from "@/lib/cart/earlyAdd";

export default function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CartProvider>
      {/*
        سكريبت الإضافة المبكّرة. مضمَّن في HTML عمداً (لا ملف خارجي ولا
        next/script) لأن الغاية كلها أن يعمل زر «أضف للسلة» قبل تنزيل أي
        حزمة: هنا يُنفَّذ وقت تحليل الصفحة، أي قبل الترطيب بثوانٍ على 4G
        بطيء. وموضعه قبل الترويسة والمحتوى يضمن أن مستمعه مسجَّل قبل أن
        يظهر أول زر على الشاشة. التفاصيل والضمانات في lib/cart/earlyAdd.ts.
      */}
      <script dangerouslySetInnerHTML={{ __html: EARLY_ADD_SCRIPT }} />
      {/* قياس داخلي مجهول — لا يعرض شيئاً ولا يؤثِّر على التخطيط. */}
      <AnalyticsClient />
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        {/* مساحة بقدر ارتفاع الشريط الثابت، حتى لا يحجب آخر سطر في الصفحة. */}
        <div className="h-20 sm:hidden" aria-hidden="true" />
      </div>
      <MobileCartBar />
    </CartProvider>
  );
}
