import type { MetadataRoute } from "next";
import { getCategories, getProducts } from "@/lib/queries/catalog";
import { safeQuery } from "@/lib/safeQuery";
import { getSiteUrl } from "@/lib/siteUrl";

// لا نخترع دومين Production أبداً: بدون SITE_URL (env var حقيقي بعد ربط
// الدومين النهائي) نُرجع خريطة موقع فارغة بدل روابط مطلَقة وهمية.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  if (!siteUrl) return [];

  const [categories, products] = await Promise.all([
    safeQuery(() => getCategories(), [], "sitemap.getCategories"),
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
