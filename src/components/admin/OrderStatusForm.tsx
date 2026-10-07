"use client";

import { useActionState, useRef, useState } from "react";
import { updateOrderStatus, type OrderActionState } from "@/app/admin/(protected)/orders/actions";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  RESTOCKING_STATUSES,
  CANCELLATION_REASONS,
  CANCELLATION_REASON_LABELS,
  CANCELLATION_REASON_REQUIRING_NOTE,
  type OrderStatus,
} from "@/lib/orders/orderStatus";

const initialState: OrderActionState = { error: null };

export function OrderStatusForm({ orderId, currentStatus }: { orderId: number; currentStatus: string }) {
  const [state, formAction, isPending] = useActionState(updateOrderStatus, initialState);
  const noteRef = useRef<HTMLInputElement>(null);
  // الحالة المختارة تُتابَع في الواجهة لسبب واحد: حقل السبب يظهر فقط مع
  // الحالات التي تُنهي الطلب. select غير مُتحكَّم به لا يُخبر أحداً بما
  // اختاره المستخدم قبل الإرسال.
  const [selected, setSelected] = useState<string>(currentStatus);
  const [reason, setReason] = useState<string>("");

  const needsReason = RESTOCKING_STATUSES.includes(selected as OrderStatus);
  const needsNote = needsReason && reason === CANCELLATION_REASON_REQUIRING_NOTE;

  return (
    <form
      action={async (formData) => {
        await formAction(formData);
        if (noteRef.current) noteRef.current.value = "";
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium text-neutral-700">تغيير الحالة</span>
          {/* key={currentStatus}: defaultValue على عنصر <select> غير المُتحكَّم به
              (uncontrolled) لا يُعاد تطبيقه تلقائياً عند تغيّر الـprop فقط —
              يحتاج React لمعاملة العنصر كجديد كلياً (remount) ليأخذ القيمة
              المحدَّثة بعد نجاح تغيير الحالة فعلياً في قاعدة البيانات. */}
          <select
            key={currentStatus}
            name="status"
            defaultValue={currentStatus}
            onChange={(event) => setSelected(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
                {RESTOCKING_STATUSES.includes(s) ? " (يُرجع المخزون المحجوز)" : ""}
              </option>
            ))}
          </select>
        </label>

        {needsReason && (
          <label className="flex-1 text-sm">
            <span className="mb-1 block font-medium text-neutral-700">
              السبب <span className="text-red-600">*</span>
            </span>
            <select
              name="cancellationReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— اختر السبب —</option>
              {CANCELLATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {CANCELLATION_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        )}

        <input
          ref={noteRef}
          name="note"
          placeholder={needsNote ? "اشرح السبب (إلزامي)" : "ملاحظة اختيارية"}
          required={needsNote}
          className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 shrink-0 rounded-lg bg-brand-orange px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isPending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
      </div>

      {needsReason && (
        <p className="text-xs leading-relaxed text-neutral-500">
          الإلغاء يحفظ الطلب وسطوره وتاريخه وإسناده كاملاً ويُرجع المخزون
          المحجوز. السبب إلزامي لأنه هو ما يُجيب لاحقاً: لماذا نخسر الطلبات.
        </p>
      )}
      {state.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
