"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
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
 * لا يحجب الصفحة ولا يمنع الشراء: الرفض لا يكلّف الزائر شيئاً. ولا يظهر
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
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="الموافقة على كوكيز الإشهار"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 text-sm text-neutral-700">
        <p>
          نستعمل كوكيز <strong>Meta</strong> (فيسبوك وإنستغرام) لقياس نتائج إعلاناتنا وعرض
          إعلانات تناسبك. تُنقل هذه البيانات إلى Meta خارج المغرب، ولا نُفعّلها إلا
          بموافقتك. الرفض لا يمنعك من الطلب، ويمكنك تغيير اختيارك في أي وقت من أسفل
          الصفحة.{" "}
          <Link href="/privacy" className="font-medium underline">
            سياسة الخصوصية
          </Link>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => choose("granted")}
            className="min-h-11 flex-1 rounded-full border border-neutral-800 bg-neutral-800 px-4 font-semibold text-white"
          >
            موافق
          </button>
          <button
            type="button"
            onClick={() => choose("denied")}
            className="min-h-11 flex-1 rounded-full border border-neutral-800 bg-white px-4 font-semibold text-neutral-800"
          >
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
