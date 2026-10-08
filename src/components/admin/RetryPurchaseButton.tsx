"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryDeferredPurchase } from "@/app/admin/(protected)/orders/actions";

/**
 * إعادة إرسال بيعةٍ مؤكَّدة تعثّر تسليمها إلى Meta.
 *
 * ## لماذا زرّ يدوي أصلاً
 *
 * حدث الشراء يحجز حرسه **قبل** النداء (وإلّا لاحتُسبت البيعة مرتين عند
 * استدعاءين متوازيين). فإذا فشل النداء يُحرَّر الحجز تلقائياً وتُعاد
 * المحاولة على أول تغيير حالة لاحق — لكن طلباً وصل `delivered` ولن يلمسه
 * أحد بعدها كان سيبقى بلا بيعة إلى الأبد، وفشلٌ كهذا صامت: لا يظهر إلا
 * كنقص في تقارير الحملة بعد أيام. هذا الزرّ هو المحاولة الأخيرة بيد إنسان.
 *
 * والتكرار آمن: `event_id` حتمي (`purchase:<id>`) فأي وصول مزدوج تُسقطه
 * Meta بنفسها.
 */
export function RetryPurchaseButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2 flex flex-col gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await retryDeferredPurchase(orderId);
            if (result.error !== null) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
        className="min-h-11 self-start rounded-full border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-40"
      >
        {isPending ? "جارٍ إعادة الإرسال…" : "إعادة إرسال البيعة إلى Meta"}
      </button>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
      )}
    </div>
  );
}
