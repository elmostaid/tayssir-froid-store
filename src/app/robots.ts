import type { MetadataRoute } from "next";
import { getSiteUrl, isProductionDeployment } from "@/lib/siteUrl";

// نمنع الفهرسة افتراضياً (Preview على Vercel، التطوير المحلي، أو أي بيئة لم
// تُؤكَّد بعد كـ Production حقيقي) ولا نسمح بها إلا في نشر Vercel Production
// الفعلي — حتى لا تُفهرَس نسخة المعاينة عن طريق الخطأ في نتائج البحث.
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  const allowIndexing = isProductionDeployment();

  return {
    rules: {
      userAgent: "*",
      allow: allowIndexing ? "/" : undefined,
      disallow: allowIndexing ? ["/admin"] : "/",
    },
    sitemap: siteUrl ? `${siteUrl}/sitemap.xml` : undefined,
  };
}
