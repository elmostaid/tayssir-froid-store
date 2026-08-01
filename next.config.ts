import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // صور المنتجات محلية حالياً داخل public/product-images وتمر عبر مُحسِّن
    // next/image (تحسين تلقائي للحجم/الصيغة + srcset)، وهذا يعمل بدون أي
    // remotePatterns لأنها مسارات محلية. مهم: عند ربط مخزن Supabase Storage
    // الحقيقي عبر NEXT_PUBLIC_SUPABASE_STORAGE_URL (انظر src/lib/images.ts)
    // يجب حينها إضافة نطاقه هنا ضمن remotePatterns، وإلا فشل next/image في
    // تحميل أي صورة قادمة من ذلك النطاق الخارجي.
  },
};

export default nextConfig;
