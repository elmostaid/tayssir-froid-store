"use client";

import { useActionState } from "react";
import {
  updateActualDeliveryCost,
  type OrderActionState,
} from "@/app/admin/(protected)/orders/actions";
import { deliveryMargin } from "@/lib/orders/deliveryCost";
import { formatMad } from "@/lib/format";

const initialState: OrderActionState = { error: null };

/**
 * خانة «كم كلّفنا هذا التوصيل فعلاً».
 *
 * منفصلة عن خانة مصاريف التوصيل المجاورة لأن الرقمين يُعرفان في وقتين
 * مختلفين: ما يدفعه الزبون يُحدَّد قبل الإرسال (بعدد الكراتين)، وما تأخذه
 * شركة التوصيل يصل بعد التسليم أحياناً بأيام. فالموظف يفتح الطلب لاحقاً
 * ويكتب الرقم النهائي وحده، بلا أن يمرّ بأي حقل يخصّ الزبون.
 *
 * والفرق يُعرَض فور الحفظ تحت الخانة، لأن السالب هنا ليس تفصيلاً محاسبياً:
 * هو المبلغ الذي خرج من ربح هذا الطلب بالذات.
 */
export function ActualDeliveryCostForm({
  orderId,
  currentActualDeliveryCost,
  currentDeliveryFee,
}: {
  orderId: number;
  currentActualDeliveryCost: string | null;
  currentDeliveryFee: string | null;
}) {
  const [state, formAction, isPending] = useActionState(updateActualDeliveryCost, initialState);

  const margin = deliveryMargin({
    deliveryFee: currentDeliveryFee,
    actualDeliveryCost: currentActualDeliveryCost,
  });

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            تكلفة التوصيل الفعلية (درهم)
          </span>
          <input
            key={currentActualDeliveryCost ?? "none"}
            name="actualDeliveryCost"
            type="number"
            min={0}
            step="0.01"
            defaultValue={currentActualDeliveryCost ?? ""}
            placeholder="ما دفعناه لشركة التوصيل"
            className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 shrink-0 rounded-lg bg-neutral-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isPending ? "جارٍ الحفظ…" : "حفظ التكلفة"}
        </button>
      </div>

      {margin === null ? (
        <p className="text-xs text-amber-700">
          غير مسجَّلة — هذا الطلب لا يدخل حساب تكلفة التوصيل في التقارير، ولا يُحتسَب صفراً.
          اتركها فارغة إن لم تعرف الرقم بعد.
        </p>
      ) : (
        <p className="text-xs text-neutral-600">
          فرق التوصيل:{" "}
          <span
            className={`font-bold tabular-nums ${
              margin < 0 ? "text-red-700" : margin > 0 ? "text-green-700" : "text-neutral-700"
            }`}
          >
            {margin > 0 ? "+" : ""}
            {formatMad(margin)}
          </span>{" "}
          <span className="text-neutral-500">
            (المحصَّل {formatMad(Number(currentDeliveryFee ?? 0))} − التكلفة{" "}
            {formatMad(Number(currentActualDeliveryCost))})
          </span>
          {margin < 0 && (
            <span className="mt-0.5 block text-red-700">
              نتحمّل هذا الفرق من ربح الطلب.
            </span>
          )}
        </p>
      )}

      <p className="text-[11px] text-neutral-500">
        اتركها فارغة واحفظ لمسح القيمة وإرجاعها إلى «غير مسجَّلة». هذا الرقم داخلي ولا يغيّر
        المبلغ الذي يدفعه الزبون.
      </p>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
