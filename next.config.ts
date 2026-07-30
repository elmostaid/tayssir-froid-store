import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // الصور التجريبية الحالية SVG محلية داخل public/demo-images وتُعرض عبر
    // unoptimized (بدون المرور بمُحسِّن next/image) فلا حاجة لتفعيل
    // dangerouslyAllowSVG إطلاقاً — هذا يزيل مساحة الخطر الأمنية بالكامل
    // بدل التخفيف منها فقط. بعد ربط مخزن Supabase Storage الحقيقي بصور
    // JPEG/PNG، أضف نطاقه ضمن remotePatterns هنا.
  },
};

export default nextConfig;
