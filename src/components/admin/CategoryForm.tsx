"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { CategoryFormState } from "@/app/admin/(protected)/categories/actions";
import type { AdminCategory } from "@/lib/queries/adminCategories";
import { slugify } from "@/lib/slugify";

const initialState: CategoryFormState = { error: null };

export function CategoryForm({
  action,
  category,
  parentOptions,
  mode,
}: {
  action: (prevState: CategoryFormState, formData: FormData) => Promise<CategoryFormState>;
  category?: AdminCategory;
  parentOptions: AdminCategory[];
  mode: "create" | "edit";
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");

  function handleNameArChange(value: string) {
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  const fieldError = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">الاسم العربي *</span>
        <input
          name="nameAr"
          required
          maxLength={100}
          defaultValue={category?.name_ar}
          onChange={(e) => handleNameArChange(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("nameAr") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("nameAr")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">الاسم الفرنسي (اختياري)</span>
        <input
          name="nameFr"
          maxLength={100}
          defaultValue={category?.name_fr ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">الرابط (slug) *</span>
        <input
          name="slug"
          required
          maxLength={80}
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          dir="ltr"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-turquoise focus:outline-none"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          يبقى الرابط ثابتاً عند تعديل الاسم لاحقاً إلا إذا غيّرته هنا صراحة.
        </span>
        {fieldError("slug") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("slug")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">التصنيف الأب (اختياري)</span>
        <select
          name="parentId"
          defaultValue={category?.parent_id ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        >
          <option value="">— بدون (تصنيف رئيسي) —</option>
          {parentOptions
            .filter((p) => p.id !== category?.id && p.parent_id === null)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name_ar}
              </option>
            ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">ترتيب العرض</span>
        <input
          name="sortOrder"
          type="number"
          min={0}
          max={9999}
          defaultValue={category?.sort_order ?? 0}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          name="isActive"
          type="checkbox"
          defaultChecked={category?.is_active ?? true}
          className="h-4 w-4"
        />
        <span className="font-medium text-neutral-700">ظاهر في الموقع</span>
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {state.error}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 rounded-full bg-brand-orange px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {isPending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
        <Link
          href="/admin/categories"
          className="flex-1 rounded-full border border-neutral-300 px-5 py-3 text-center text-sm font-semibold text-neutral-700"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
