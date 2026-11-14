"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrder } from "@/app/admin/(protected)/orders/actions";

/**
 * حذف الطلب نهائياً — إجراء إداري استثنائي، لا طريقة الإلغاء اليومية.
 *
 * ## لماذا صار محجوزاً بهذا الشكل
 *
 * كان زراً واحداً بجوار الإجراءات العادية في كل طلب. والقياس أظهر أن ذلك
 * صار مسار الإلغاء الفعلي: 38 طلباً محذوفاً نهائياً بقيمة 45,985 درهم،
 * مقابل **طلب واحد** أُلغي بالطريقة الصحيحة. والحذف يمحو السطور وسجل
 * الحالات بـCASCADE، فلا يبقى جواب عن "ماذا كان فيه ولماذا خسرناه" — ولا
 * تعرف Meta أبداً أن البيعة التي أُبلغت بها لم تكتمل.
 *
 * فالآن: يظهر فقط على طلب **ملغى أصلاً**، ويطلب سبباً مكتوباً ونسخ رقم
 * الطلب حرفياً. والشروط نفسها تُفحَص من جديد داخل `deleteOrder` — إخفاء
 * الحقول ليس هو الحماية.
 */
export function DeleteOrderButton({
  orderId,
  orderNumber,
}: {
  orderId: number;
  orderNumber: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");

  const typedMatches = typed.trim() === orderNumber;
  const reasonOk = reason.trim().length >= 10;
  const canSubmit = typedMatches && reasonOk && !isPending;

  function handleClick() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteOrder(orderId, reason.trim());
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      // صفحة هذا الطلب لم تعد موجودة بعد الحذف — نعود لقائمة الطلبات ونمرّر
      // رقم الطلب المحذوف لتُعرض رسالة نجاح واضحة هناك.
      router.push(`/admin/orders?deleted=${encodeURIComponent(result.orderNumber)}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          سبب الحذف النهائي <span className="text-red-600">*</span>
        </span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="عشرة أحرف على الأقل — يُحفظ في سجل الحذف"
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          اكتب <code className="rounded bg-neutral-100 px-1">{orderNumber}</code> للتأكيد
        </span>
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={orderNumber}
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={handleClick}
        disabled={!canSubmit}
        className="min-h-11 self-start rounded-full border border-red-300 px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-40"
      >
        {isPending ? "جارٍ الحذف…" : "حذف الطلب نهائياً"}
      </button>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
