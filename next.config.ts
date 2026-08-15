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
    // ⚠️ تاريخ هذا الإعداد (السبب الجذري الحقيقي والمؤكَّد — مهم قبل أي
    // تغيير آخر):
    // السبب الحقيقي وراء كل صور مكسورة متقطّعة منذ بداية هذا التحقيق (على
    // الأجهزة القديمة، ثم بعد تفعيل Desktop mode، ثم بالجملة على الصفحة
    // الرئيسية) هو خطأ حقيقي من Vercel نفسها: 402 PAYMENT_REQUIRED, code
    // OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED — حساب Vercel تجاوز الحد
    // المسموح لخدمة تحسين الصور المدفوعة (/_next/image). هذا يفسّر التذبذب
    // (بعض الطلبات كانت تنجح ضمن الحد المتبقي/من ذاكرة مؤقتة، وبعضها يُرفض)
    // أفضل من أي فرضية سابقة (صيغة ملفات، تذبذب تحت الحمل، cache قديم).
    //
    // unoptimized: true يُلغي كامل الاعتماد على تلك الخدمة المدفوعة —
    // <Image> يُصيَّر كوسم <img> عادي يشير مباشرة لملف public/ الأصلي، فلا
    // يوجد أي طلب لـ/_next/image يمكن أن يُرفض بـ402 إطلاقاً. هذا الحل
    // الدائم الصحيح، وليس إجراءً مؤقتاً — بشرط واحد: أن تكون الملفات
    // الأصلية خفيفة أصلاً (راجع النقطة التالية).
    //
    // ⚠️ خطر متبقٍّ يجب إغلاقه قريباً: صور دفعة product-images-v3 (والمصادر
    // الأقدم) لا تزال PNG أصلية ضخمة فقاعدة البيانات الحالية (متوسط ~1.5
    // ميغابايت، حتى 3+ ميغابايت) لأن migration استبدالها بنسخ JPEG خفيفة
    // (~170 كيلوبايت، جاهزة أصلاً فـsupabase/migrations/20260815000000_*.sql)
    // لم تُطبَّق بعد على قاعدة الإنتاج (عبر supabase db push). بدونها، صفحة
    // تصنيف كبيرة (77+ منتج) تبقى ثقيلة على شبكات ضعيفة رغم عدم كسر أي
    // صورة. تطبيق تلك migration هو ما يُكمِّل الحل: صور صغيرة + بلا اعتماد
    // على خدمة مدفوعة معاً، بلا أي مقايضة متبقية.
    unoptimized: true,
  },
};

export default nextConfig;
