"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { getOrderAttribution } from "@/lib/attribution/capture";
import {
  inquiryReferenceFromKey,
  withInquiryReference,
  type InquiryKind,
} from "@/lib/whatsappInquiry";

/**
 * رابط واتساب للاستفسار، بمرجع Q- يسافر داخل الرسالة.
 *
 * ## المرجع يُكتب لحظة الضغط، لا قبلها
 *
 * `href` المرسوم من الخادم هو الرسالة نفسها بلا مرجع — يعمل بلا JavaScript،
 * وبلا فرق بين ما يرسمه الخادم وما يرطّبه React. عند الضغط فقط يُولَّد
 * المفتاح، ويُكتب الرابط بالمرجع على العنصر نفسه، ثم يتابع المتصفح فتح
 * واتساب بسلوك `<a>` الافتراضي (الذي يقرأ `href` بعد انتهاء المعالج). لا
 * `preventDefault` ولا `window.open`: لا شيء يجوز أن يمنع فتح المحادثة.
 *
 * والثمن معروف ومقبول: الضغط الطويل و«فتح في تبويب جديد» لا يمرّان بالمعالج،
 * فيفتحان الرسالة بلا مرجع — كما كانت كل الرسائل قبل اليوم.
 *
 * ## مفتاح واحد لكل زرّ في الصفحة
 *
 * ضغطتان على نفس الزرّ = استفسار واحد (نفس المفتاح، ON CONFLICT DO NOTHING).
 */

function newInquiryKey(): string | null {
  try {
    if (typeof crypto === "undefined") return null;
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    // بلا مصدر عشوائية آمن: لا مرجع، والرسالة تُفتح كما هي.
    return null;
  }
}

export function WhatsAppInquiryLink({
  whatsappNumber,
  message,
  kind,
  productSku,
  className,
  ariaLabel,
  onClick,
  children,
}: {
  whatsappNumber: string;
  message: string;
  kind: InquiryKind;
  productSku?: string;
  className?: string;
  ariaLabel?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const keyRef = useRef<string | null>(null);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.();

    keyRef.current ??= newInquiryKey();
    const key = keyRef.current;
    const reference = key ? inquiryReferenceFromKey(key) : null;
    if (!key || !reference) return;

    event.currentTarget.href = buildWhatsAppLink(
      whatsappNumber,
      withInquiryReference(message, reference)
    );

    try {
      void fetch("/api/whatsapp-inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          idempotencyKey: key,
          kind,
          productSku,
          pagePath: window.location.pathname,
          attribution: getOrderAttribution(),
        }),
      }).catch(() => {
        // أفضل مجهود: المرجع في الرسالة على أي حال، والمدير يرى «غير مسجَّل».
      });
    } catch {
      // keepalive غير مدعوم — نتجاهل بصمت.
    }
  }

  return (
    <a
      href={buildWhatsAppLink(whatsappNumber, message)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      onClick={handleClick}
      className={className}
    >
      {children}
    </a>
  );
}
