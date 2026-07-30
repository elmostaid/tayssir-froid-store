"use client";

import { useActionState } from "react";
import { signInAdmin, type LoginState } from "@/app/admin/login/actions";

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(signInAdmin, initialState);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          البريد الإلكتروني
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          كلمة المرور
        </span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 rounded-full bg-brand-orange px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {isPending ? "جارٍ الدخول…" : "تسجيل الدخول"}
      </button>
    </form>
  );
}
