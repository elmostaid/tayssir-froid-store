"use client";

import { useActionState } from "react";
import {
  createStaffAccount,
  type UserActionState,
} from "@/app/admin/(protected)/users/actions";

const initialState: UserActionState = { error: null };

// لا تُعرَض كلمة السر بعد الإنشاء أبداً — فقط رسالة نجاح عامة. كلمة السر
// لا تُرسَل إلا مرة واحدة إلى createStaffAccount ولا تُخزَّن ولا تُعرَض فـ
// أي استجابة لاحقة.
export function CreateStaffForm() {
  const [state, formAction, isPending] = useActionState(createStaffAccount, initialState);
  const fieldError = (field: string) => state.fieldErrors?.[field];

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4"
    >
      <h2 className="text-sm font-bold text-neutral-800">إنشاء حساب خدامة (Staff) جديد</h2>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">الاسم الكامل *</span>
        <input
          name="fullName"
          type="text"
          required
          maxLength={100}
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        {fieldError("fullName") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("fullName")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">البريد الإلكتروني *</span>
        <input
          name="email"
          type="email"
          required
          dir="ltr"
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        {fieldError("email") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("email")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">كلمة السر الأولية *</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          dir="ltr"
          autoComplete="new-password"
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          8 أحرف على الأقل. سلِّمها للخدامة مباشرة — لن تظهر مرة أخرى هنا.
        </span>
        {fieldError("password") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("password")}</span>
        )}
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 self-start rounded-lg bg-brand-orange px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "جارٍ الإنشاء…" : "إنشاء الحساب"}
      </button>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="text-sm text-green-600">
          تم إنشاء الحساب بنجاح. سلِّم البريد الإلكتروني وكلمة السر للخدامة مباشرة.
        </p>
      )}
    </form>
  );
}
