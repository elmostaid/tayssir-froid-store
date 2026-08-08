import type { MetadataRoute } from "next";
import { getSiteUrl, isProductionDeployment } from "@/lib/siteUrl";

// نمنع الفهرسة افتراضياً (Preview على Vercel، التطوير المحلي، أو أي بيئة لم
// تُؤكَّد بعد كـ Production حقيقي) ولا نسمح بها إلا في نشر Vercel Production
// الفعلي — حتى لا تُفهرَس نسخة المعاينة عن طريق الخطأ في نتائج البحث.
//
// استثناء مقصود حتى في Preview: صور المنتجات وصفحات المنتج وRoute الخاص
// بـFeed تبقى مسموحة لأي User-Agent. بدونها، Disallow: / الشامل كان يمنع
// Meta Commerce Manager (الذي يحترم robots.txt عند جلب الروابط/الصور
// المذكورة داخل Feed، رغم أنه يجلب رابط الـFeed نفسه مباشرة بغض النظر عن
// robots.txt) من جلب صور المنتجات أثناء اختبار الكاطالوغ على نسخة Preview.
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  const allowIndexing = isProductionDeployment();

  if (allowIndexing) {
    return {
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin"],
      },
      sitemap: siteUrl ? `${siteUrl}/sitemap.xml` : undefined,
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: ["/product-images/", "/product/", "/feed/"],
      disallow: "/",
    },
    sitemap: siteUrl ? `${siteUrl}/sitemap.xml` : undefined,
  };
}
