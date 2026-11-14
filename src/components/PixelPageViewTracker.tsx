"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ensureMetaPixelLoaded, trackPageView } from "@/lib/pixel/fbq";
import { isAdTrackingAllowed, readAdConsentFromDocument, subscribeAdConsent } from "@/lib/privacy/consent";

/**
 * تحميل Pixel وPageView — بعد الموافقة وحدها، ومرة واحدة لكل عرض صفحة.
 *
 * التحميل هنا لا في سكريبت مستقل لسببين: الموافقة تُقرأ في المتصفح فقط،
 * وPageView يجب أن يأتي **بعد** `fbq('init')` لا قبله. فالمكوّن نفسه يُحمّل
 * Pixel ثم يُطلق الحدث، بترتيب مضمون. وحين يوافق الزائر وهو في صفحة ما،
 * يُطلَق PageView تلك الصفحة لحظتها — لا ينتظر التنقّل التالي.
 *
 * usePathname() كافٍ (بلا useSearchParams) — تغيّر querystring فقط بلا
 * تغيّر المسار لا يُعتبَر عرض صفحة جديداً.
 */
function getServerSnapshot() {
  return "unknown" as const;
}

export function PixelPageViewTracker({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const consent = useSyncExternalStore(subscribeAdConsent, readAdConsentFromDocument, getServerSnapshot);
  const lastTrackedPathname = useRef<string | null>(null);

  useEffect(() => {
    if (!isAdTrackingAllowed(consent)) return;
    if (lastTrackedPathname.current === pathname) return;
    lastTrackedPathname.current = pathname;
    ensureMetaPixelLoaded(pixelId);
    trackPageView();
  }, [pathname, consent, pixelId]);

  return null;
}
