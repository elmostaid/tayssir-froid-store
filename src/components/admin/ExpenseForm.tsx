"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  createExpenseAction,
  updateExpenseAction,
  type ExpenseFormState,
} from "@/app/admin/(protected)/expenses/actions";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
} from "@/lib/expenses/expenseCategories";

const initialState: ExpenseFormState = { error: null };

export type ExpenseFormValues = {
  id: number;
  amountMad: number;
  category: string;
  description: string;
  spentOn: string;
  note: string | null;
};

/**
 * نموذج المصروف — إضافة وتعديل بنفس المكوّن، لأن الحقول واحدة والاختلاف
 * الوحيد أي إجراء يُستدعى.
 *
 * مبنيّ للهاتف قبل كل شيء: المبلغ أولاً بلوحة أرقام (inputMode="decimal")،
 * والتصنيف قائمة أصلية يفتحها النظام بضغطة، والتاريخ مملوء باليوم سلفاً.
 * الهدف مصروفٌ يُسجَّل في ثوانٍ وأنت واقف في المحل، لا استمارة تُملأ.
 */
export function ExpenseForm({
  mode = "create",
  expense,
  today,
  onDone,
}: {
  mode?: "create" | "edit";
  expense?: ExpenseFormValues;
  /** اليوم بتوقيت المغرب، محسوباً في الخادم — لا نثق بساعة الهاتف. */
  today: string;
  onDone?: () => void;
}) {
  const action = mode === "edit" ? updateExpenseAction : createExpenseAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // بعد حفظ ناجح: نُفرغ النموذج ونعيد التركيز إلى المبلغ، فيُسجَّل المصروف
  // التالي فوراً بلا لمس الشاشة. في وضع التعديل نُغلق بدل التفريغ.
  useEffect(() => {
    if (!state.savedAt || state.error) return;
    if (mode === "edit") {
      onDone?.();
      return;
    }
    formRef.current?.reset();
    amountRef.current?.focus();
  }, [state.savedAt, state.error, mode, onDone]);

  const fieldError = (field: string) =>
    state.fieldErrors?.find((error) => error.field === field)?.message ?? null;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      {mode === "edit" && expense && (
        <input type="hidden" name="expenseId" value={expense.id} />
      )}

      <label className="text-sm">
        <span className="mb-1 block font-semibold text-neutral-700">المبلغ بالدرهم *</span>
        <input
          ref={amountRef}
          name="amount"
          type="text"
          inputMode="decimal"
          required
          autoComplete="off"
          defaultValue={expense ? String(expense.amountMad) : ""}
          placeholder="مثال: 250"
          className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 text-lg font-bold tabular-nums focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("amount") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("amount")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-semibold text-neutral-700">التصنيف *</span>
        <select
          name="category"
          required
          defaultValue={expense?.category ?? ""}
          className="min-h-12 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base focus:border-brand-turquoise focus:outline-none"
        >
          <option value="" disabled>
            اختر التصنيف…
          </option>
          {EXPENSE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {EXPENSE_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        {fieldError("category") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("category")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-semibold text-neutral-700">البيان *</span>
        <input
          name="description"
          type="text"
          required
          maxLength={200}
          defaultValue={expense?.description ?? ""}
          placeholder="مثال: إعلان فيسبوك حملة الثلاجات"
          className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 text-base focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("description") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("description")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-semibold text-neutral-700">تاريخ المصروف *</span>
        <input
          name="spentOn"
          type="date"
          required
          defaultValue={expense?.spentOn ?? today}
          className="min-h-12 w-full rounded-lg border border-neutral-300 px-3 text-base focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("spentOn") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("spentOn")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-semibold text-neutral-700">ملاحظة (اختياري)</span>
        <textarea
          name="note"
          rows={2}
          maxLength={500}
          defaultValue={expense?.note ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("note") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("note")}</span>
        )}
      </label>

      {state.error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {state.error}
        </p>
      )}
      {state.savedAt && !state.error && mode === "create" && (
        <p role="status" className="rounded-lg bg-green-50 p-2 text-center text-sm font-semibold text-green-700">
          تم حفظ المصروف ✓
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 flex-1 rounded-full bg-brand-orange px-5 text-base font-bold text-white disabled:bg-neutral-300"
        >
          {pending ? "جارٍ الحفظ…" : mode === "edit" ? "حفظ التعديل" : "حفظ المصروف"}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            className="min-h-12 rounded-full border border-neutral-300 px-5 text-sm font-semibold text-neutral-700"
          >
            إلغاء
          </button>
        )}
      </div>
    </form>
  );
}
