"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { ProductFormState } from "@/app/admin/(protected)/products/actions";
import { generateProductSku } from "@/app/admin/(protected)/products/actions";
import type { AdminProduct } from "@/lib/queries/adminProducts";
import type { AdminCategory } from "@/lib/queries/adminCategories";
import { slugify } from "@/lib/slugify";
import { TierPricingFields } from "@/components/admin/TierPricingFields";
import type { PricingMode } from "@/lib/pricing/tierPricing";

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

type FormValues = {
  sku: string;
  nameAr: string;
  nameFr: string;
  slug: string;
  categoryId: string;
  descriptionAr: string;
  technicalSpecs: string;
  unitLabel: string;
  status: string;
  minOrderQty: string;
  qtyIncrement: string;
  salePrice: string;
  stockQuantity: string;
  purchasePrice: string;
  pricingMode: PricingMode;
  tier2MinQty: string;
  tier2Price: string;
  tier3MinQty: string;
  tier3Price: string;
  showBulkWhatsapp: boolean;
};

function initialValues(product: AdminProduct | undefined): FormValues {
  return {
    sku: product?.sku ?? "",
    nameAr: product?.name_ar ?? "",
    nameFr: product?.name_fr ?? "",
    slug: product?.slug ?? "",
    categoryId: product?.category_id ? String(product.category_id) : "",
    descriptionAr: product?.description_ar ?? "",
    technicalSpecs: product?.technical_specs ?? "",
    unitLabel: product?.unit_label ?? "قطعة",
    status: product?.status ?? "draft",
    minOrderQty: product ? String(product.min_order_qty) : "1",
    qtyIncrement: product ? String(product.qty_increment) : "1",
    salePrice: product?.sale_price ?? "",
    stockQuantity: product ? String(product.stock_quantity) : "0",
    purchasePrice: product?.purchase_price ?? "",
    pricingMode: product?.pricing_mode ?? "single",
    tier2MinQty: product?.tier2_min_qty != null ? String(product.tier2_min_qty) : "",
    tier2Price: product?.tier2_price ?? "",
    tier3MinQty: product?.tier3_min_qty != null ? String(product.tier3_min_qty) : "",
    tier3Price: product?.tier3_price ?? "",
    showBulkWhatsapp: product?.show_bulk_whatsapp ?? false,
  };
}

// كل الحقول هنا controlled (value+onChange مربوطة بحالة React) عمداً — وليس
// defaultValue كما كانت. React 19 يُصفِّر تلقائياً أي حقل غير controlled
// داخل <form action={...}> بمجرد اكتمال الإجراء (نجح أو فشل، لا فرق —
// React لا "يعرف" أن الفشل يعني "أعد نفس القيم للمستخدم") — هذا بالضبط
// سبب اختفاء كل ما كتبه المستخدم عند خطأ مثل "SKU مستعمل من قبل". حقل
// controlled محصَّن من هذا التصفير لأن قيمته المعروضة تُشتَق دائماً من
// حالة React نفسها، لا من حالة DOM الداخلية التي يُصفِّرها React.
export function ProductForm({
  action,
  product,
  categories,
  mode,
  hasActiveVariants = false,
}: {
  action: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  product?: AdminProduct;
  categories: AdminCategory[];
  mode: "create" | "edit";
  hasActiveVariants?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [values, setValues] = useState<FormValues>(() => initialValues(product));
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [skuTouched, setSkuTouched] = useState(mode === "edit");
  const [isGeneratingSku, startSkuGeneration] = useTransition();
  const [skuGenerationError, setSkuGenerationError] = useState<string | null>(null);

  function setValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleNameArChange(value: string) {
    setValue("nameAr", value);
    if (!slugTouched) {
      setValue("slug", slugify(value));
    }
  }

  function requestSkuSuggestion(categoryId: string) {
    if (mode !== "create" || skuTouched || !categoryId) return;
    setSkuGenerationError(null);
    startSkuGeneration(async () => {
      const result = await generateProductSku(Number(categoryId));
      if ("error" in result) {
        setSkuGenerationError(result.error);
        return;
      }
      // فحص ثانٍ: المستخدم قد يكون كتب شيئاً بنفسه أثناء انتظار الاقتراح.
      setValues((prev) => (skuTouched ? prev : { ...prev, sku: result.sku }));
    });
  }

  function handleCategoryChange(value: string) {
    setValue("categoryId", value);
    requestSkuSuggestion(value);
  }

  function handleGenerateSkuClick() {
    if (!values.categoryId) {
      setSkuGenerationError("اختر تصنيفاً أولاً.");
      return;
    }
    setSkuGenerationError(null);
    startSkuGeneration(async () => {
      const result = await generateProductSku(Number(values.categoryId));
      if ("error" in result) {
        setSkuGenerationError(result.error);
        return;
      }
      setSkuTouched(true);
      setValue("sku", result.sku);
    });
  }

  const fieldError = (field: string) => state.fieldErrors?.[field];
  const categoryOptions = buildCategoryOptions(categories);

  // onSubmit يدوي (يستدعي formAction مباشرة) بدل <form action={formAction}>
  // عمداً: الربط المباشر بـaction فالـform يُفعِّل آلية React 19 الأصلية
  // لـ"form actions"، التي تُصفِّر عناصر <select> إلى أول خيار فيها بعد
  // اكتمال أي إجراء (نجح أو فشل) — بغض النظر عن كون بقية الحقول controlled.
  // استدعاء formAction() مباشرة من معالج حدث عادي (مدعوم رسمياً من
  // useActionState) يتجاوز تلك الآلية تماماً؛ isPending/state يبقيان يعملان
  // بالضبط كما هما (نفس دالة formAction المُغلَّفة بـtransition داخلياً).
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    formAction(new FormData(e.currentTarget));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">SKU *</span>
        <div className="flex gap-2">
          <input
            name="sku"
            required
            maxLength={50}
            dir="ltr"
            value={values.sku}
            onChange={(e) => {
              setValue("sku", e.target.value);
              setSkuTouched(true);
            }}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-turquoise focus:outline-none"
          />
          {mode === "create" && (
            <button
              type="button"
              onClick={handleGenerateSkuClick}
              disabled={isGeneratingSku}
              className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-60"
            >
              {isGeneratingSku ? "…" : "توليد SKU"}
            </button>
          )}
        </div>
        {skuGenerationError && (
          <span className="mt-1 block text-xs text-amber-700">{skuGenerationError}</span>
        )}
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
          value={values.nameAr}
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
          value={values.nameFr}
          onChange={(e) => setValue("nameFr", e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">الرابط (slug) *</span>
        <input
          name="slug"
          required
          maxLength={100}
          value={values.slug}
          onChange={(e) => {
            setValue("slug", e.target.value);
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
          value={values.categoryId}
          onChange={(e) => handleCategoryChange(e.target.value)}
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
          value={values.descriptionAr}
          onChange={(e) => setValue("descriptionAr", e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">مواصفات تقنية (اختياري)</span>
        <textarea
          name="technicalSpecs"
          maxLength={1000}
          rows={3}
          value={values.technicalSpecs}
          onChange={(e) => setValue("technicalSpecs", e.target.value)}
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
            value={values.unitLabel}
            onChange={(e) => setValue("unitLabel", e.target.value)}
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
            value={values.status}
            onChange={(e) => setValue("status", e.target.value)}
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
            value={values.minOrderQty}
            onChange={(e) => setValue("minOrderQty", e.target.value)}
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
            value={values.qtyIncrement}
            onChange={(e) => setValue("qtyIncrement", e.target.value)}
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
            value={values.salePrice}
            onChange={(e) => setValue("salePrice", e.target.value)}
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
            value={values.stockQuantity}
            onChange={(e) => setValue("stockQuantity", e.target.value)}
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
          value={values.purchasePrice}
          onChange={(e) => setValue("purchasePrice", e.target.value)}
          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
        {fieldError("purchasePrice") && (
          <span className="mt-1 block text-xs text-red-600">{fieldError("purchasePrice")}</span>
        )}
      </label>

      <TierPricingFields
        pricingMode={values.pricingMode}
        onPricingModeChange={(next) => setValue("pricingMode", next)}
        values={{
          tier2MinQty: values.tier2MinQty,
          tier2Price: values.tier2Price,
          tier3MinQty: values.tier3MinQty,
          tier3Price: values.tier3Price,
        }}
        onChange={(key, value) => setValue(key, value)}
        showBulkWhatsapp={values.showBulkWhatsapp}
        onShowBulkWhatsappChange={(checked) => setValue("showBulkWhatsapp", checked)}
        unitLabel={values.unitLabel}
        hasActiveVariants={hasActiveVariants}
        fieldError={fieldError}
      />

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
