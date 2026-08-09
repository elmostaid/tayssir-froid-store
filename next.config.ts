import type { NextConfig } from "next";

// next/image يرفض عرض أي صورة من مضيف خارجي غير مُدرَج صراحةً فـ
// remotePatterns (يرمي استثناءً وقت التصيير — بالضبط سبب "Server Error"
// المُبلَّغ عنه فـ/admin/products بعد ظهور أول صورة من Supabase Storage
// الحقيقي). نشتق النطاق تلقائياً من NEXT_PUBLIC_SUPABASE_URL نفسه (نفس
// المتغيّر الذي يبني عليه resolveProductImageUrl الرابط العام) بدل تكراره
// يدوياً؛ فارغ محلياً حيث لا يوجد هذا المتغيّر، فلا يتغيّر شيء فالتطوير
// المحلي (الصور المحلية لا تحتاج remotePatterns أصلاً).
function supabaseStorageRemotePattern(): NonNullable<NextConfig["images"]>["remotePatterns"] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];
  try {
    const { hostname } = new URL(url);
    return [
      {
        protocol: "https",
        hostname,
        pathname: "/storage/v1/object/public/**",
      },
    ];
  } catch {
    return [];
  }
}

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
    // صور المنتجات القديمة محلية داخل public/product-images وتمر عبر مُحسِّن
    // next/image بدون أي remotePatterns لأنها مسارات محلية. الصور المرفوعة
    // حديثاً إلى bucket "product-images" الحقيقي فـSupabase Storage تحتاج
    // مضيفها مُدرَجاً هنا — يُضاف تلقائياً أعلاه.
    remotePatterns: supabaseStorageRemotePattern(),
  },
};

export default nextConfig;
