"use client";

import { useMemo, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import {
  buildCartWhatsAppMessage,
  randomOrderReference,
} from "@/lib/orders/orderMessage";
import { getOrderAttribution } from "@/lib/attribution/capture";
import { trackAnalyticsEvent } from "@/lib/analytics/track";

/**
 * «أكمل الطلب عبر واتساب» — طلب يبدأ من السلة بلا نموذج.
 *
 * **الدليل الذي أوجبه** (9 أيام، `analytics_events`): إتمام الطلب على هذا
 * الموقع ينتهي على واتساب أصلاً، لكن الطريق إليه يمرّ بثلاثة حقول إجبارية.
 * ومن يدفع هذا الثمن يختلف باختلاف المتصفّح اختلافاً حاداً:
 *
 *   متصفّح إنستغرام الداخلي   10 بدايات ← 6 طلبات   (60%)
 *   كروم على الهاتف          15 بداية  ← 5 طلبات   (33%)
 *   متصفّح فيسبوك الداخلي    40 بداية  ← 8 طلبات   (20%)  ← الأكبر والأسوأ
 *
 * ومتصفّح فيسبوك وحده جاء بـ325 إضافة للسلة من أصل 797. أي أن أكبر مصدر
 * للزبناء هو أسوأ مكان لملء نموذج. وفي نفس الأسبوع أنهى المالك ثلاثة طلبات
 * يدوياً على واتساب بـ7,751 درهم ومتوسط 2,584 — مقابل 862 للموقع.
 *
 * **ما هذا الزر وما ليس هو.** ليس بديلاً عن إتمام الطلب: النموذج يبقى
 * الزرَّ الأول بلونه ووزنه، لأنه وحده ما يُنشئ طلباً حقيقياً برقم وحجز
 * مخزون وبون تحضير. هذا مخرج ثانٍ لمن كان سيغادر — الرسالة تحمل الطلبية
 * كاملة والمرجع، والبائع يأخذ الاسم والمدينة في المحادثة.
 *
 * **ولماذا يُسجَّل حدثاً مستقلاً.** `whatsapp_from_cart` ليس تزييناً: بدونه
 * لا نعرف هل أضاف هذا المسار طلبات أم سحبها من النموذج فقط. الحدث يُرسَل
 * قبل مغادرة الصفحة عبر sendBeacon (طبقة القياس نفسها)، فينجو من الانتقال.
 */
export function CartWhatsAppButton({
  whatsappNumber,
  storeName,
  className,
  label = "أكمل الطلب عبر واتساب",
}: {
  whatsappNumber: string;
  storeName: string;
  className?: string;
  /** نصّ الزر. `null` يعني أيقونة وحدها — للشريط الضيّق أسفل الشاشة. */
  label?: string | null;
}) {
  const { items, subtotal } = useCart();

  // مرجع ثابت لعمر المكوّن: الزبون الذي يضغط مرتين يصل برسالتين تحملان نفس
  // المرجع، فيعرف البائع أنها طلبية واحدة لا اثنتان.
  const [reference] = useState(randomOrderReference);

  const href = useMemo(() => {
    if (items.length === 0) return null;

    // المصدر يُقرأ من آخر لمسة إعلانية محفوظة. لا نرسل مُعرّف النقرة نفسه
    // (fbclid) في رسالة واتساب — سطر مقروء يكفي لمعرفة أي قناة باعت، وحمل
    // مُعرّف يخصّ شخصاً بعينه إلى محادثة ليس له داعٍ.
    const attribution = getOrderAttribution();
    const touch = attribution?.last ?? attribution?.first ?? null;
    const parts = [touch?.utmSource, touch?.utmMedium].filter(Boolean);
    const attributionNote =
      parts.length > 0
        ? parts.join(" / ")
        : touch?.referrerHost ?? null;

    return buildWhatsAppLink(
      whatsappNumber,
      buildCartWhatsAppMessage({
        storeName,
        reference,
        items,
        subtotal,
        whatsappNumber,
        attributionNote,
      })
    );
  }, [items, subtotal, whatsappNumber, storeName, reference]);

  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label ?? "أكمل الطلب عبر واتساب"}
      onClick={() => {
        // لا try/catch هنا: trackAnalyticsEvent لا ترمي أبداً بحكم تصميمها،
        // ولا شيء في هذا المعالج يجوز أن يمنع فتح واتساب.
        trackAnalyticsEvent("whatsapp_from_cart", { cartValue: subtotal });
      }}
      className={
        className ??
        "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-whatsapp px-5 text-base font-bold text-white transition-colors hover:bg-whatsapp-dark"
      }
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.11-1.34A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Zm0 18c-1.6 0-3.1-.43-4.4-1.19l-.32-.19-3.03.8.81-2.95-.2-.3A7.95 7.95 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8Zm4.4-5.9c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.44-1.34-1.68-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
      </svg>
      {label}
    </a>
  );
}
