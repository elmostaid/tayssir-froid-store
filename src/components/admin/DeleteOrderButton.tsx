"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrder } from "@/app/admin/(protected)/orders/actions";

/**
 * زر حذف الطلب نهائياً. يظهر فقط داخل قسم مقصور على Owner/Admin في صفحة
 * تفاصيل الطلب — والصلاحية تُفحص من جديد داخل deleteOrder نفسه، فإخفاء الزر
 * ليس هو الحماية.
 *
 * التأكيد يذكر رقم الطلب صراحةً: صاحب المتجر قد يفتح عدة طلبات في وقت واحد،
 * ورسالة عامة ("هل تريد الحذف؟") لا تُطمئنه أنه يحذف الطلب الذي يقصده.
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

  function handleClick() {
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف الطلب ${orderNumber}؟ لا يمكن التراجع عن هذا الإجراء.`
    );
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteOrder(orderId);
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
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="min-h-11 rounded-full border border-red-300 px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? "جارٍ الحذف…" : "حذف الطلب"}
      </button>
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
