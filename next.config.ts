import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // الصور التجريبية الحالية SVG محلية داخل public/demo-images.
    // بعد ربط مخزن Supabase Storage الحقيقي، أضف نطاقه ضمن remotePatterns.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
  },
};

export default nextConfig;
