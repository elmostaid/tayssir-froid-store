"use client";

import { useActionState, useState, useTransition } from "react";
import type { AdminAccount } from "@/lib/queries/adminUsers";
import {
  updateAccountRole,
  disableAccount,
  enableAccount,
  deleteAccount,
  type UserActionState,
} from "@/app/admin/(protected)/users/actions";

const initialState: UserActionState = { error: null };

export function AdminAccountRow({
  account,
  isSelf,
}: {
  account: AdminAccount;
  isSelf: boolean;
}) {
  const boundUpdateRole = updateAccountRole.bind(null, account.id);
  const [roleState, roleFormAction, isRolePending] = useActionState(boundUpdateRole, initialState);

  const [isTogglePending, startToggleTransition] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [isDeletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isDisabled = account.disabledAt !== null;

  function handleToggleDisabled() {
    setToggleError(null);
    startToggleTransition(async () => {
      const result = isDisabled ? await enableAccount(account.id) : await disableAccount(account.id);
      if (result.error) setToggleError(result.error);
    });
  }

  function handleDelete() {
    if (!window.confirm(`هل تريد فعلاً حذف حساب "${account.fullName ?? account.email ?? account.id}" نهائياً؟`)) {
      return;
    }
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteAccount(account.id);
      if (result.error) setDeleteError(result.error);
      else if (result.warning) setDeleteError(result.warning);
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-800">
            {account.fullName ?? "(بلا اسم)"}
            {isSelf && <span className="text-xs font-normal text-neutral-400"> — أنت</span>}
          </p>
          <p className="truncate text-xs text-neutral-500" dir="ltr">
            {account.email ?? "—"}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            أُنشئ: {new Date(account.createdAt).toLocaleDateString("ar-MA")}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            isDisabled ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
          }`}
        >
          {isDisabled ? "معطَّل" : "نشط"}
        </span>
      </div>

      <form action={roleFormAction} className="mt-3 flex items-center gap-2">
        <select
          name="role"
          defaultValue={account.role}
          className="min-h-10 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="admin">Admin</option>
          <option value="staff">Staff</option>
        </select>
        <button
          type="submit"
          disabled={isRolePending}
          className="min-h-10 rounded-lg bg-brand-turquoise px-3 text-xs font-semibold text-white disabled:opacity-60"
        >
          {isRolePending ? "جارٍ الحفظ…" : "حفظ الدور"}
        </button>
      </form>
      {roleState.error && <p className="mt-1 text-xs text-red-600">{roleState.error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggleDisabled}
          disabled={isTogglePending}
          className="min-h-10 rounded-lg border border-neutral-300 px-3 text-xs font-semibold text-neutral-700 disabled:opacity-60"
        >
          {isTogglePending ? "جارٍ…" : isDisabled ? "تفعيل" : "تعطيل"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeletePending}
          className="min-h-10 rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-600 disabled:opacity-60"
        >
          {isDeletePending ? "جارٍ…" : "حذف نهائي"}
        </button>
      </div>
      {toggleError && <p className="mt-1 text-xs text-red-600">{toggleError}</p>}
      {deleteError && <p className="mt-1 text-xs text-red-600">{deleteError}</p>}
    </div>
  );
}
