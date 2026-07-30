"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { ProductFormState } from "@/app/admin/(protected)/products/actions";
import type { AdminProduct } from "@/lib/queries/adminProducts";
import type { AdminCategory } from "@/lib/queries/adminCategories";
import { slugify } from "@/lib/slugify";

const initialState: ProductFormState = { error: null };

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft", label: "مسودة (مخفي عن الزوار)" },
  { value: "published", label: "منشور" },
  { value: "out_of_stock", label: "غير متوفر (ظاهر لكن غير قابل للطلب)" },
];

function buildCategoryOptions(categories: AdminCategory[]) {
  const topLevel = categories.filter((c) => c.parent_id === null);
  const options: { id: number; label: string }[] = [];
  for (const parent of topLevel) {
    options.push({ id: parent.id, label: parent.name_ar });
    const children = categories.filter((c) => c.parent_id === parent.id);
    for (const child of children) {
      options.push({ id: child.id, label: `— ${child.name_ar}` });
    }
  }
  return options;
}

export function ProductForm({
  action,
  product,
  categories,
  mode,
}: {
  action: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  product?: AdminProduct;
  categories: AdminCategory[];
  mode: "create" | "edit";
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");

  function handleNameArChange(value: string) {
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  const fieldError = (field: string) => state.fieldErrors?.[field];
  const categoryOptions = buildCategoryOptions(categories);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">SKU *</span>
        <input
          name="sku"
          required
          maxLength={50}
          dir="ltr"
          defaultValue={product?.sku}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("sku") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("sku")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">الاسم العربي *</span>
        <input
          name="nameAr"
          required
          maxLength={150}
          defaultValue={product?.name_ar}
          onChange={(e) => handleNameArChange(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("nameAr") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("nameAr")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          الاسم الفرنسي / التقني (اختياري)
        </span>
        <input
          name="nameFr"
          maxLength={150}
          defaultValue={product?.name_fr ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">الرابط (slug) *</span>
        <input
          name="slug"
          required
          maxLength={100}
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          dir="ltr"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("slug") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("slug")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">التصنيف *</span>
        <select
          name="categoryId"
          required
          defaultValue={product?.category_id ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        >
          <option value="" disabled>
            — اختر تصنيفاً —
          </option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {fieldError("categoryId") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("categoryId")}</span>
        )}
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">وصف مختصر (اختياري)</span>
        <textarea
          name="descriptionAr"
          maxLength={1000}
          rows={3}
          defaultValue={product?.description_ar ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">مواصفات تقنية (اختياري)</span>
        <textarea
          name="technicalSpecs"
          maxLength={1000}
          rows={3}
          defaultValue={product?.technical_specs ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">وحدة البيع *</span>
          <input
            name="unitLabel"
            required
            maxLength={30}
            defaultValue={product?.unit_label ?? "قطعة"}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
          {fieldError("unitLabel") && (
            <span className="mt-1 block text-xs text-red-600">{fieldError("unitLabel")}</span>
          )}
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">الحالة *</span>
          <select
            name="status"
            required
            defaultValue={product?.status ?? "draft"}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">الكمية الدنيا للطلب *</span>
          <input
            name="minOrderQty"
            type="number"
            min={1}
            required
            defaultValue={product?.min_order_qty ?? 1}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
          {fieldError("minOrderQty") && (
            <span className="mt-1 block text-xs text-red-600">{fieldError("minOrderQty")}</span>
          )}
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">درجة زيادة الكمية *</span>
          <input
            name="qtyIncrement"
            type="number"
            min={1}
            required
            defaultValue={product?.qty_increment ?? 1}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
          {fieldError("qtyIncrement") && (
            <span className="mt-1 block text-xs text-red-600">{fieldError("qtyIncrement")}</span>
          )}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">ثمن البيع (درهم) *</span>
          <input
            name="salePrice"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={product?.sale_price ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
          {fieldError("salePrice") && (
            <span className="mt-1 block text-xs text-red-600">{fieldError("salePrice")}</span>
          )}
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">المخزون *</span>
          <input
            name="stockQuantity"
            type="number"
            min={0}
            required
            defaultValue={product?.stock_quantity ?? 0}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
          {fieldError("stockQuantity") && (
            <span className="mt-1 block text-xs text-red-600">{fieldError("stockQuantity")}</span>
          )}
        </label>
      </div>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          ثمن الشراء (درهم) — خاص بالإدارة فقط، لا يظهر أبداً للزوار
        </span>
        <input
          name="purchasePrice"
          type="number"
          min={0}
          step="0.01"
          defaultValue={product?.purchase_price ?? ""}
          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("purchasePrice") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("purchasePrice")}</span>
        )}
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
          تم الحفظ بنجاح.
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
          href="/admin/products"
          className="flex-1 rounded-full border border-neutral-300 px-5 py-3 text-center text-sm font-semibold text-neutral-700"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
