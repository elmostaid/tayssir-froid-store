"use client";

import { useState, useTransition } from "react";
import { deleteCategory } from "@/app/admin/(protected)/categories/actions";

export function DeleteCategoryButton({ categoryId }: { categoryId: number }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm("هل تريد فعلاً حذف هذا التصنيف؟")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCategory(categoryId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
      >
        حذف
      </button>
      {error && <p className="mt-1 max-w-40 text-xs text-red-600">{error}</p>}
    </div>
  );
}
