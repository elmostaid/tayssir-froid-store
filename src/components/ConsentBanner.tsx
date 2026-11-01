"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { trackAnalyticsEvent } from "@/lib/analytics/track";
import {
  readAdConsentFromDocument,
  subscribeAdConsent,
  writeAdConsent,
  type AdConsent,
} from "@/lib/privacy/consent";

/**
 * شريط الموافقة على كوكيز الإشهار — قبل أي Pixel.
 *
 * ## ما يفرضه النص، حرفياً
 *
 * مداولة CNDP D-939-2025، الفقرة 6: الموافقة «بفعل واضح وصريح»، بوسائل
 * «بسيطة ومتاحة» تسمح بـ**الرفض**، ومعلومات قبل أول إيداع: هوية المسؤول،
 * الغاية، فئات البيانات، المُتلقّون بما فيه النقل للخارج، وطريقة ممارسة
 * الحقوق. فالزرّان بنفس الوزن (الرفض ليس رابطاً باهتاً)، والنصّ يقول من
 * يتلقّى البيانات، والتفاصيل في /privacy.
 *
 * ## ما لا يفعله
 *
 * لا يحجب الصفحة ولا يمنع الشراء: الرفض لا يكلّف الزائر شيئاً، والسلة
 * وواتساب وإتمام الطلب تعمل دون أن يجيب. على الهاتف يقف **فوق** شريط
 * السلة حين يظهر، لا فوقه (globals.css، `[data-consent-banner]`). ولا يظهر
 * قبل الترطيب (لقطة الخادم `null`): الخادم لا يعرف الاختيار، ورسمه ثم
 * إخفاؤه يُومض أمام كل من اختار سابقاً.
 */

const OPEN_EVENT = "tf:open-consent";

function getServerSnapshot(): AdConsent | null {
  return null;
}

export function ConsentBanner() {
  const consent = useSyncExternalStore(subscribeAdConsent, readAdConsentFromDocument, getServerSnapshot);
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    const open = () => setReopened(true);
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  if (consent === null) return null;
  if (consent !== "unknown" && !reopened) return null;

  function choose(value: "granted" | "denied") {
    writeAdConsent(value);
    setReopened(false);
    // القياس الداخلي (أول طرف، بلا معرّف إعلاني): كم وافق وكم رفض.
    // `immediate`: الزائر قد يغادر بعد الضغط مباشرة.
    trackAnalyticsEvent(value === "granted" ? "ad_consent_granted" : "ad_consent_denied", {}, { immediate: true });
  }

  // الزرّان بنفس الصنف حرفياً: لا لون يدفع نحو «موافق». اختبار يقارنهما.
  const buttonClass =
    "min-h-11 flex-1 rounded-full border border-neutral-800 bg-white px-4 font-semibold text-neutral-800 sm:flex-none sm:px-8";

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="الموافقة على كوكيز الإشهار"
      data-consent-banner
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white px-3 py-2.5 shadow-lg sm:p-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 text-[13px] leading-5 text-neutral-700 sm:flex-row sm:items-center sm:gap-4 sm:text-sm">
        <p className="sm:flex-1">
          نستعمل كوكيز <strong>Meta</strong> (فيسبوك وإنستغرام) لقياس إعلاناتنا وتخصيصها، وتُنقل
          بياناتها خارج المغرب — بموافقتك فقط. الرفض لا يمنعك من الطلب، وتغيّر اختيارك متى شئت من
          أسفل الصفحة.{" "}
          <Link href="/privacy" className="font-medium underline">
            التفاصيل
          </Link>
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => choose("granted")} className={buttonClass}>
            موافق
          </button>
          <button type="button" onClick={() => choose("denied")} className={buttonClass}>
            رفض
          </button>
        </div>
      </div>
    </div>
  );
}

/** رابط «إعدادات الخصوصية» في التذييل — يُعيد فتح الشريط لتغيير الاختيار. */
export function PrivacySettingsLink() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="underline"
    >
      إعدادات الكوكيز
    </button>
  );
}
