"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import type { ProductFormState } from "@/app/admin/(protected)/products/actions";
import type { ImageActionState, UploadTargetState } from "@/app/admin/(protected)/products/imageActions";
import type { AdminProduct, AdminProductImage } from "@/lib/queries/adminProducts";
import { LOW_STOCK_THRESHOLD } from "@/lib/lowStockThreshold";
import { ProductImagesPanel } from "@/components/admin/ProductImagesPanel";

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
  images,
  imageUrlByPath,
  canUploadImages,
  createUploadTargetAction,
  commitPrimaryUploadAction,
  commitAdditionalUploadAction,
  imagesWithActions,
  isFirstInCategory,
  isLastInCategory,
  onMoveUp,
  onMoveDown,
  onMoveToRank,
}: {
  product: AdminProduct;
  action: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  images: AdminProductImage[];
  // storage_path → رابط جاهز للعرض، مُحلَّل من جهة الخادم (محلي أو Supabase
  // Storage الحقيقي حسب مكان وجود الملف فعلياً). راجع resolveProductImageUrl.
  imageUrlByPath: Record<string, string>;
  canUploadImages: boolean;
  createUploadTargetAction: (contentType: string) => Promise<UploadTargetState>;
  commitPrimaryUploadAction: (objectPath: string) => Promise<ImageActionState>;
  commitAdditionalUploadAction: (objectPath: string, altText: string | null) => Promise<ImageActionState>;
  imagesWithActions: {
    image: AdminProductImage;
    setPrimaryAction: () => Promise<{ error: string | null }>;
    deleteAction: () => Promise<{ error: string | null }>;
  }[];
  // ترتيب المنتج داخل تصنيفه فقط (sort_order) — "↑"/"↓"/"نقل" لا تلمس أي
  // حقل آخر (الاسم/الثمن/المخزون/الصور/SKU/الحالة)، ولا تقارن إلا بمنتجات
  // نفس category_id (محسوبة من ترتيب القائمة الكاملة فـReorderableProductsList).
  // لا زر يعمل شيئاً عند حدود التصنيف (أول/آخر منتج).
  isFirstInCategory: boolean;
  isLastInCategory: boolean;
  onMoveUp: () => Promise<{ error: string | null }>;
  onMoveDown: () => Promise<{ error: string | null }>;
  onMoveToRank: (rank: number) => Promise<{ error: string | null }>;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const fieldError = (field: string) => state.fieldErrors?.[field];

  const [isReordering, startReorderTransition] = useTransition();
  const [reorderError, setReorderError] = useState<string | null>(null);

  // خانة "المرتبة": قيمة نصية مستقلة (وليست مربوطة مباشرة بـproduct.sort_order
  // كـcontrolled input بلا وسيط) لتسمح للمستخدم بالكتابة بحرية، مع مزامنتها
  // من جديد كلما تغيّرت مرتبة المنتج الفعلية (نقل ناجح لهذا المنتج أو لجاره).
  // تحديث أثناء الرندر نفسه (نمط React الموصى به لـ"تعديل الحالة عند تغيّر
  // prop") بدل useEffect+setState، لتفادي رندر إضافي متتالٍ بلا داعٍ.
  const [prevSortOrder, setPrevSortOrder] = useState(product.sort_order);
  const [rankInput, setRankInput] = useState(String(product.sort_order));
  if (product.sort_order !== prevSortOrder) {
    setPrevSortOrder(product.sort_order);
    setRankInput(String(product.sort_order));
  }

  function handleMove(e: React.MouseEvent<HTMLButtonElement>, moveAction: () => Promise<{ error: string | null }>) {
    e.preventDefault();
    e.stopPropagation();
    setReorderError(null);
    startReorderTransition(async () => {
      const result = await moveAction();
      if (result.error) setReorderError(result.error);
    });
  }

  function handleMoveToRank(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const parsed = Number(rankInput);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setReorderError("أدخل رقم مرتبة صحيح (1 أو أكثر).");
      return;
    }
    setReorderError(null);
    startReorderTransition(async () => {
      const result = await onMoveToRank(parsed);
      if (result.error) setReorderError(result.error);
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3">
        <ProductImagesPanel
          productNameAr={product.name_ar}
          images={images}
          imageUrlByPath={imageUrlByPath}
          canUploadImages={canUploadImages}
          createUploadTargetAction={createUploadTargetAction}
          commitPrimaryUploadAction={commitPrimaryUploadAction}
          commitAdditionalUploadAction={commitAdditionalUploadAction}
          imagesWithActions={imagesWithActions}
        />
      </div>

      {/* ترتيب المنتج داخل تصنيفه — خارج فورم الثمن/المخزون تماماً، بلا أي
          علاقة أو تأثير على حفظه. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => handleMove(e, onMoveUp)}
          disabled={isReordering || isFirstInCategory}
          aria-label="طلّع المنتج للأعلى داخل نفس التصنيف"
          title="طلّع"
          className="flex min-h-9 min-w-9 items-center justify-center rounded-full border border-neutral-300 text-sm text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={(e) => handleMove(e, onMoveDown)}
          disabled={isReordering || isLastInCategory}
          aria-label="هبّط المنتج للأسفل داخل نفس التصنيف"
          title="هبّط"
          className="flex min-h-9 min-w-9 items-center justify-center rounded-full border border-neutral-300 text-sm text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↓
        </button>

        <span className="mx-0.5 h-6 w-px shrink-0 bg-neutral-200" aria-hidden />

        <label className="flex items-center gap-1 text-xs text-neutral-600">
          المرتبة
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={rankInput}
            onChange={(e) => setRankInput(e.target.value)}
            disabled={isReordering}
            aria-label="مرتبة المنتج داخل تصنيفه"
            className="min-h-9 w-16 rounded-lg border border-neutral-300 px-2 py-1 text-center text-sm disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          onClick={handleMoveToRank}
          disabled={isReordering}
          className="min-h-9 rounded-lg border border-neutral-300 px-3 text-xs font-semibold text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          نقل
        </button>

        {reorderError && <p className="w-full text-xs text-red-600">{reorderError}</p>}
      </div>

      <form action={formAction}>
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
    </div>
  );
}
