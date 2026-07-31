"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import type { ProductFormState } from "@/app/admin/(protected)/products/actions";
import type { AdminProductVariant } from "@/lib/queries/adminProducts";

const initialState: ProductFormState = { error: null };

function VariantFields({
  variant,
  fieldError,
}: {
  variant?: AdminProductVariant;
  fieldError: (field: string) => string | undefined;
}) {
  return (
    <>
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">اسم المتغير *</span>
        <input
          name="variantName"
          required
          maxLength={60}
          defaultValue={variant?.variant_name}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("variantName") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("variantName")}</span>
        )}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            ثمن خاص بهذا المتغير (اختياري)
          </span>
          <input
            name="salePriceOverride"
            type="number"
            min={0}
            step="0.01"
            defaultValue={variant?.sale_price_override ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">المخزون *</span>
          <input
            name="stockQuantity"
            type="number"
            min={0}
            required
            defaultValue={variant?.stock_quantity ?? 0}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            كمية دنيا خاصة (اختياري)
          </span>
          <input
            name="minOrderQtyOverride"
            type="number"
            min={1}
            defaultValue={variant?.min_order_qty_override ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            درجة زيادة خاصة (اختياري)
          </span>
          <input
            name="qtyIncrementOverride"
            type="number"
            min={1}
            defaultValue={variant?.qty_increment_override ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 items-center">
        <label className="flex items-center gap-2 text-sm">
          <input
            name="isActive"
            type="checkbox"
            defaultChecked={variant?.is_active ?? true}
            className="h-4 w-4"
          />
          <span className="font-medium text-neutral-700">مفعّل</span>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">ترتيب العرض</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={9999}
            defaultValue={variant?.sort_order ?? 0}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
        </label>
      </div>
    </>
  );
}

function VariantRow({
  variant,
  updateAction,
  deleteAction,
}: {
  variant: AdminProductVariant;
  updateAction: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  deleteAction: () => Promise<{ error: string | null }>;
}) {
  const [state, formAction, isPending] = useActionState(updateAction, initialState);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fieldError = (field: string) => state.fieldErrors?.[field];

  function handleDelete() {
    if (!window.confirm(`حذف المتغير "${variant.variant_name}"؟`)) return;
    startDeleteTransition(async () => {
      const result = await deleteAction();
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3"
    >
      <VariantFields variant={variant} fieldError={fieldError} />

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {state.error}
        </p>
      )}
      {deleteError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {deleteError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 rounded-full bg-brand-turquoise px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {isPending ? "جارٍ الحفظ…" : "حفظ التعديل"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="rounded-full border border-red-300 px-4 py-2 text-xs font-semibold text-red-700 disabled:opacity-60"
        >
          حذف
        </button>
      </div>
    </form>
  );
}

function NewVariantForm({
  createAction,
}: {
  createAction: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
}) {
  const [state, formAction, isPending] = useActionState(createAction, initialState);
  const fieldError = (field: string) => state.fieldErrors?.[field];

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-dashed border-neutral-300 p-3"
    >
      <p className="text-sm font-semibold text-neutral-700">إضافة متغير جديد</p>
      <VariantFields fieldError={fieldError} />

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-brand-orange px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "جارٍ الإضافة…" : "إضافة المتغير"}
      </button>
    </form>
  );
}

export function VariantManager({
  variantsWithActions,
  createAction,
}: {
  variantsWithActions: {
    variant: AdminProductVariant;
    updateAction: (
      prevState: ProductFormState,
      formData: FormData
    ) => Promise<ProductFormState>;
    deleteAction: () => Promise<{ error: string | null }>;
  }[];
  createAction: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {variantsWithActions.length === 0 && (
        <p className="text-sm text-neutral-500">لا توجد متغيرات لهذا المنتج بعد.</p>
      )}
      {variantsWithActions.map(({ variant, updateAction, deleteAction }) => (
        <VariantRow
          key={variant.id}
          variant={variant}
          updateAction={updateAction}
          deleteAction={deleteAction}
        />
      ))}
      <NewVariantForm createAction={createAction} />
    </div>
  );
}
