"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getOrCreateSession } from "@/lib/analytics/session";
import { trackAnalyticsEvent } from "@/lib/analytics/track";

/**
 * الأحداث التي تُشتقّ من التنقّل وحده: بداية الجلسة، صفحة الهبوط، وعرض
 * السلة. باقي الأحداث تُطلق من مكانها الطبيعي (بطاقة المنتج، صفحة المنتج،
 * Checkout) لأنها تحتاج بيانات لا يعرفها المسار.
 *
 * مكوّن فارغ بصرياً (يُرجع null): لا يضيف أي عنصر إلى الصفحة ولا يؤثِّر على
 * أي تخطيط، ولا يفعل شيئاً إطلاقاً قبل اكتمال العرض لأنه كله داخل useEffect.
 */
export function AnalyticsClient() {
  const pathname = usePathname();
  const startedRef = useRef(false);
  const lastCartViewPath = useRef<string | null>(null);

  // بداية الجلسة وصفحة الهبوط: مرة واحدة لكل جلسة حقيقية. زائر يتنقّل بين
  // عشر صفحات يبقى جلسة واحدة وصفحة هبوط واحدة — وهذا بالضبط ما يجعل
  // "عدد الزوّار" في اللوحة عدد أشخاص لا عدد صفحات.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const session = getOrCreateSession();
    if (!session?.isNew) return;

    trackAnalyticsEvent("session_start");
    trackAnalyticsEvent("landing_page_view");
  }, []);

  // عرض السلة: عند كل وصول فعلي إلى /cart. الرجوع إليها بعد تصفّح منتج آخر
  // عرضٌ ثانٍ حقيقي، لكن إعادة رندر المكوّن في نفس الصفحة ليست كذلك.
  useEffect(() => {
    if (pathname !== "/cart") {
      lastCartViewPath.current = null;
      return;
    }
    if (lastCartViewPath.current === pathname) return;
    lastCartViewPath.current = pathname;
    trackAnalyticsEvent("cart_view");
  }, [pathname]);

  return null;
}
