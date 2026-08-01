import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // مسارات توليد PDF (بون التحضير ووصل الزبون) تقرأ ملفات الخط العربي محلياً
  // عبر path.join(process.cwd(), ...) وقت التشغيل بدل import ثابت، وقد لا
  // يكتشفها تتبّع الملفات التلقائي لـVercel دائماً — نضمن تضمينها صراحةً.
  outputFileTracingIncludes: {
    "/admin/orders/[id]/picking-slip.pdf": [
      "./src/lib/pdf/fonts/**/*",
      "./public/brand/**/*",
    ],
    "/order/[reference]/receipt.pdf": [
      "./src/lib/pdf/fonts/**/*",
      "./public/brand/**/*",
    ],
  },
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
