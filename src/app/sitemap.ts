import type { MetadataRoute } from "next";
import { getFilteredCategories, getProducts } from "@/lib/queries/catalog";
import { safeQuery } from "@/lib/safeQuery";
import { getSiteUrl } from "@/lib/siteUrl";

// بلا هذا كان Next.js يُنشئ هذا الملف ثابتاً وقت البناء فقط (لا استدعاءات
// fetch/cookies هنا تدفعه تلقائياً إلى dynamic) — أي تغيير لاحق فنشر/إخفاء
// تصنيف أو إضافة منتج لن يظهر فـsitemap.xml حتى إعادة نشر (Deployment)
// جديدة. جميع صفحات الموقع الأخرى (الرئيسية، التصنيف) أصلاً force-dynamic.
export const dynamic = "force-dynamic";

// لا نخترع دومين Production أبداً: بدون SITE_URL (env var حقيقي بعد ربط
// الدومين النهائي) نُرجع خريطة موقع فارغة بدل روابط مطلَقة وهمية.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  if (!siteUrl) return [];

  const [categories, products] = await Promise.all([
    getFilteredCategories("sitemap.getCategories"),
    safeQuery(() => getProducts({ limit: 1000 }), [], "sitemap.getProducts"),
  ]);

  const entries: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "daily", priority: 1 },
  ];

  for (const category of categories) {
    entries.push({
      url: `${siteUrl}/category/${category.slug}`,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  for (const product of products) {
    entries.push({
      url: `${siteUrl}/product/${product.slug}`,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return entries;
}
