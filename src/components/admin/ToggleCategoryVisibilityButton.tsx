"use client";

import { useState, useTransition } from "react";
import { toggleCategoryVisibility } from "@/app/admin/(protected)/categories/actions";

export function ToggleCategoryVisibilityButton({
  categoryId,
  isActive,
}: {
  categoryId: number;
  isActive: boolean;
}) {
  const [active, setActive] = useState(isActive);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const next = !active;
    setError(null);
    startTransition(async () => {
      const result = await toggleCategoryVisibility(categoryId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setActive(next);
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={
          active
            ? "rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-50"
            : "rounded-full bg-brand-turquoise px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        }
      >
        {isPending ? "…" : active ? "إخفاء من الموقع" : "نشر في الموقع"}
      </button>
      {error && <p className="mt-1 max-w-40 text-xs text-red-600">{error}</p>}
    </div>
  );
}
