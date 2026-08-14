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
    // القيمة الافتراضية فـNext.js هي ["image/webp"]: مُحسِّن next/image يحوّل
    // أي صورة (حتى JPEG/PNG المصدر) إلى مخرَج WebP تلقائياً لأي متصفح يُصرِّح
    // بدعمه عبر ترويسة Accept — بغضّ النظر عن صيغة الملف الأصلي فعلياً. هذا
    // بالضبط ما جعل تحويل صورتَي التصنيف (نصف/الأوتوماتيكية) إلى JPEG وحده
    // غير كافٍ: بعض الهواتف (آيفون قديمة، أندرويد قديم) تُصرِّح بدعم WebP فـ
    // Accept فعلياً بينما فك تشفيرها الحقيقي محدود/معطوب لبعض حاويات WebP —
    // فتصل الصورة بصيغة WebP مُعاد ترميزها رغم أن الملف الأصلي كان JPEG.
    //
    // ⚠️ جُرِّب أولاً formats: [] (تعطيل قائمة الصيغ المسموح تحويلها) على أمل
    // إيقاف أي تحويل — لكن تتبُّع الشيفرة الفعلية لـnext/dist/.../image-optimizer.js
    // (عبر مكتبة @hapi/accept الداخلية) أظهر أن قائمة تفضيلات فارغة تُعامَل
    // كـ"بلا أي تقييد" فتعود للاعتماد على ترويسة Accept من المتصفح مباشرة —
    // عكس المطلوب تماماً. تحقّق فعلي بـcurl مع Accept: image/webp أثبت أن
    // formats: [] لا يمنع التحويل إطلاقاً.
    //
    // unoptimized: true هو الإيقاف الحقيقي الوحيد: يُلغي كامل خط أنابيب
    // /_next/image (تصغير + إعادة ترميز) لكل صورة فالموقع، ويُصيَّر <Image>
    // كوسم <img> عادي يشير مباشرة لمسار الملف الأصلي — فتصل كل صورة للمتصفح
    // بنفس بايتاتها وصيغتها على القرص حرفياً، بلا أي تدخّل خادم. هذا "fallback
    // مباشر للصورة" بمعناه الحرفي: أقصى توافق ممكن مع كل جهاز/متصفح قديم أو
    // حديث، بكلفة فقدان التصغير التلقائي حسب حجم الشاشة (صور بحجمها الأصلي
    // دائماً) — مقايضة مقبولة هنا لأن ظهور الصورة أهم من توفير بايتات إضافية.
    unoptimized: true,
  },
};

export default nextConfig;
