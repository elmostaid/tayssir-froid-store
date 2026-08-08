"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ProductFormState } from "@/app/admin/(protected)/products/actions";
import type { AdminProduct } from "@/lib/queries/adminProducts";
import { LOW_STOCK_THRESHOLD } from "@/lib/lowStockThreshold";

const initialState: ProductFormState = { error: null };

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft", label: "مسودة (مخفي)" },
  { value: "published", label: "منشور" },
  { value: "out_of_stock", label: "غير متوفر" },
  { value: "archived", label: "مؤرشف" },
];

// صف تعديل سريع مستقل تماماً عن باقي الصفوف: useActionState خاص به،
// وformData الخاصة به فقط تُرسَل عند الحفظ — حفظ منتج لا يقرأ ولا يرسل أي
// قيمة من صف منتج آخر فـنفس الصفحة (لا "ضياع تعديلات" متبادل بين المنتجات).
export function ProductQuickEditRow({
  product,
  action,
}: {
  product: AdminProduct;
  action: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const fieldError = (field: string) => state.fieldErrors?.[field];

  return (
    <form
      action={formAction}
      className="rounded-xl border border-neutral-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/admin/products/${product.id}`}
            className="truncate text-sm font-semibold text-neutral-800 hover:text-brand-turquoise-dark hover:underline"
          >
            {product.name_ar}
          </Link>
          <p className="text-xs text-neutral-500">
            {product.category_name_ar} · SKU: <span dir="ltr">{product.sku}</span>
          </p>
        </div>
        {product.stock_quantity <= LOW_STOCK_THRESHOLD && (
          <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            {product.stock_quantity <= 0 ? "نفد" : "مخزون منخفض"}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="text-xs">
          <span className="mb-1 block text-neutral-500">ثمن البيع</span>
          <input
            name="salePrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={product.sale_price}
            required
            className="min-h-10 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
          {fieldError("salePrice") && (
            <span className="mt-0.5 block text-red-600">{fieldError("salePrice")}</span>
          )}
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-neutral-500">ثمن الشراء</span>
          <input
            name="purchasePrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={product.purchase_price ?? ""}
            placeholder="—"
            className="min-h-10 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
          {fieldError("purchasePrice") && (
            <span className="mt-0.5 block text-red-600">{fieldError("purchasePrice")}</span>
          )}
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-neutral-500">المخزون</span>
          <input
            name="stockQuantity"
            type="number"
            min={0}
            step="1"
            defaultValue={product.stock_quantity}
            required
            className="min-h-10 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
          {fieldError("stockQuantity") && (
            <span className="mt-0.5 block text-red-600">{fieldError("stockQuantity")}</span>
          )}
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-neutral-500">أقل كمية</span>
          <input
            name="minOrderQty"
            type="number"
            min={1}
            step="1"
            defaultValue={product.min_order_qty}
            required
            className="min-h-10 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
          {fieldError("minOrderQty") && (
            <span className="mt-0.5 block text-red-600">{fieldError("minOrderQty")}</span>
          )}
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-neutral-500">الحالة</span>
          <select
            name="status"
            defaultValue={product.status}
            className="min-h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-10 rounded-lg bg-brand-turquoise px-4 text-xs font-semibold text-white disabled:opacity-60"
        >
          {isPending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        {state.success && <p className="text-xs text-green-600">تم الحفظ.</p>}
      </div>
    </form>
  );
}
