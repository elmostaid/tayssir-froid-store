"use client";

import { useState, useTransition } from "react";
import { deleteExpenseAction } from "@/app/admin/(protected)/expenses/actions";
import { ExpenseForm, type ExpenseFormValues } from "@/components/admin/ExpenseForm";
import { expenseCategoryLabel } from "@/lib/expenses/expenseCategories";
import { formatMad } from "@/lib/format";

/**
 * سطر واحد في سجلّ المصاريف، مع تعديله وحذفه.
 *
 * التعديل يفتح نفس نموذج الإضافة مكانَ السطر بدل صفحة ثانية: المصروف سطرٌ
 * من خمسة حقول، والانتقال بين صفحتين لتغيير رقم أطول من التغيير نفسه.
 */
export function ExpenseRowActions({
  expense,
  today,
}: {
  expense: ExpenseFormValues;
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    // نافذة تأكيد تذكر المبلغ والبيان: «هل تريد الحذف؟» وحدها تُضغط بلا
    // قراءة، وحذف مصروف لا رجعة فيه.
    const confirmed = window.confirm(
      `حذف هذا المصروف نهائياً؟\n\n${formatMad(expense.amountMad)} — ${expense.description}\n${expenseCategoryLabel(expense.category)} · ${expense.spentOn}`
    );
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteExpenseAction(expense.id);
      if (result.error) setError(result.error);
    });
  }

  if (editing) {
    return (
      <div className="mt-3 rounded-lg border border-brand-orange/40 bg-white p-3">
        <p className="mb-2 text-xs font-semibold text-neutral-600">تعديل المصروف</p>
        <ExpenseForm
          mode="edit"
          expense={expense}
          today={today}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={pending}
          className="min-h-9 text-xs font-semibold text-brand-turquoise-dark hover:underline disabled:opacity-50"
        >
          تعديل
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="min-h-9 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
        >
          {pending ? "جارٍ الحذف…" : "حذف"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
