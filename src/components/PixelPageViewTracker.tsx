"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/lib/pixel/fbq";

/**
 * PageView بلا تكرار: سكريبت Pixel الأساسي (MetaPixel.tsx) يُهيّئ fbq فقط
 * (fbq('init', ...)) بلا أي fbq('track','PageView') تلقائي داخله — هذا
 * المكوّن وحده مسؤول عن إطلاق PageView، مرة واحدة فقط لكل عرض صفحة حقيقي:
 * التحميل الأول (mount)، وكل تنقّل لاحق بين الصفحات عبر next/link (App
 * Router لا يُعيد تحميل السكريبت أو الصفحة كاملة عند هذا التنقّل، فبدون هذا
 * المكوّن لن يُسجَّل PageView إطلاقاً لتلك الزيارات اللاحقة). usePathname()
 * كافٍ (بلا useSearchParams) — تغيّر querystring فقط بلا تغيّر المسار لا
 * يُعتبَر عرض صفحة جديداً هنا.
 */
export function PixelPageViewTracker() {
  const pathname = usePathname();
  const lastTrackedPathname = useRef<string | null>(null);

  useEffect(() => {
    if (lastTrackedPathname.current === pathname) return;
    lastTrackedPathname.current = pathname;
    trackPageView();
  }, [pathname]);

  return null;
}
