import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CartProvider } from "@/components/CartProvider";
import { AnalyticsClient } from "@/components/AnalyticsClient";
import { AttributionTracker } from "@/components/AttributionTracker";
import { MobileCartBar } from "@/components/MobileCartBar";
import { EARLY_ADD_SCRIPT } from "@/lib/cart/earlyAdd";
import { ImageFallbackScript } from "@/components/ImageFallbackScript";

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
      {/*
        حارس الصور: يسقط أي صورة فشل تحميلها إلى أصلها. موضعه هنا — قبل
        الترويسة والمحتوى — لنفس سبب السكريبت أعلاه: يجب أن يكون مسجَّلاً
        قبل أن يبدأ المتصفح تحميل أول صورة، لا بعده. التفاصيل في الملف.
      */}
      <ImageFallbackScript />
      {/* قياس داخلي مجهول — لا يعرض شيئاً ولا يؤثِّر على التخطيط. */}
      <AnalyticsClient />
      {/* نسب الطلب إلى مصدره — مسار مستقل، لا يعرض شيئاً. */}
      <AttributionTracker />
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        {/* الشريط الثابت ومساحته معاً: يختفيان في نفس الصفحات، فلا تبقى
            مساحة فارغة أسفل صفحة لا شريط فيها. */}
        <MobileCartBar />
      </div>
    </CartProvider>
  );
}
