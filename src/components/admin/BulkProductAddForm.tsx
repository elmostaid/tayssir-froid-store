"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";
import type { AdminCategory } from "@/lib/queries/adminCategories";
import { validateImageFile, MAX_IMAGES_PER_PRODUCT } from "@/lib/storage/imageValidation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createBulkProduct } from "@/app/admin/(protected)/products/bulkActions";
import {
  createImageUploadTarget,
  commitPrimaryImage,
  commitAdditionalImage,
} from "@/app/admin/(protected)/products/imageActions";

const PRODUCT_IMAGES_BUCKET = "product-images";

const STATUS_OPTIONS: { value: "draft" | "published" | "out_of_stock"; label: string }[] = [
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

// أفضل تصنيف مطابق لنص حر (category_ar من ملف ZIP) — تخمين مبدئي فقط، يبقى
// قابلاً للتغيير يدوياً دائماً فالقائمة المنسدلة قبل أي حفظ فعلي. لا يُنشئ
// أي تصنيف جديد أبداً — فقط يقترح من القائمة الموجودة فعلاً.
export function guessCategoryId(freeText: string, options: { id: number; label: string }[]): string {
  const words = freeText
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  if (words.length === 0) return "";

  let bestId: number | null = null;
  let bestScore = 0;
  for (const opt of options) {
    const score = words.filter((w) => opt.label.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestId = opt.id;
    }
  }
  return bestScore >= 2 && bestId !== null ? String(bestId) : "";
}

type RowImage = {
  clientId: string;
  file: File;
  previewUrl: string;
};

type RowStatus = "idle" | "pending" | "success" | "duplicate" | "error";

export type Row = {
  clientId: string;
  nameAr: string;
  purchasePrice: string;
  salePrice: string;
  minOrderQtyOverride: string;
  stockQuantity: string;
  stockRequired: boolean;
  images: RowImage[];
  status: RowStatus;
  message: string | null;
  sku: string | null;
};

function newRow(): Row {
  return {
    clientId: crypto.randomUUID(),
    nameAr: "",
    purchasePrice: "",
    salePrice: "",
    minOrderQtyOverride: "",
    stockQuantity: "",
    stockRequired: false,
    images: [],
    status: "idle",
    message: null,
    sku: null,
  };
}

export function isRowEmpty(row: Row): boolean {
  return !row.nameAr.trim() && row.images.length === 0;
}

// يفصل النص الملصوق (من Excel/جدول) إلى أسطر، وكل سطر بفاصلة Tab (الافتراضي
// عند اللصق من Excel) أو فاصلة عادية: الاسم، ثمن الشراء، ثمن البيع، وأقل
// عدد اختياري رابع. أسطر فارغة أو بلا اسم تُتجاهَل بصمت.
function parsePastedRows(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: Row[] = [];
  for (const line of lines) {
    const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    const [nameAr, purchasePrice, salePrice, minOrderQty] = cells;
    if (!nameAr) continue;
    const row = newRow();
    row.nameAr = nameAr;
    row.purchasePrice = purchasePrice ?? "";
    row.salePrice = salePrice ?? "";
    row.minOrderQtyOverride = minOrderQty ?? "";
    rows.push(row);
  }
  return rows;
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function mimeFromFilename(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? (EXT_TO_MIME[ext] ?? null) : null;
}

// مخطط products.json المتوقَّع فملف الدفعة (ZIP) — حقل واحد إجباري فعلياً
// (name_ar)، البقية اختيارية ببدائل معقولة. لا نخترع أي قيمة سعر/كمية غير
// موجودة صراحة فالملف؛ كمية مفقودة (stock: null/غائبة) تُترك فارغة وتُعلَّم
// كخانة إجبارية يعمرها المدير بنفسه قبل الحفظ.
export type ZipProductEntry = {
  name_ar?: string;
  model?: string;
  purchase_price_mad?: number;
  sale_price_mad?: number;
  min_quantity?: number;
  stock?: number | null;
  category_ar?: string;
  image_folder?: string;
  primary_image?: string;
  images?: string[];
};

export type ZipImportOutcome = {
  rows: Row[];
  categoryGuessId: string;
  errors: string[];
};

export async function parseZipFile(
  file: File,
  categoryOptions: { id: number; label: string }[]
): Promise<ZipImportOutcome> {
  const errors: string[] = [];
  const zip = await JSZip.loadAsync(file);

  // products.json قد يكون فجذر الأرشيف أو داخل مجلد فرعي واحد (كل حزم
  // العميل حتى الآن مبنية بمجلد جذر واحد يحوي كل شيء).
  const jsonEntry = Object.values(zip.files).find(
    (f) => !f.dir && f.name.toLowerCase().endsWith("products.json")
  );
  if (!jsonEntry) {
    return { rows: [], categoryGuessId: "", errors: ["لم يُعثر على products.json داخل الملف."] };
  }

  let parsed: ZipProductEntry[];
  try {
    const text = await jsonEntry.async("text");
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("not an array");
    parsed = data;
  } catch {
    return { rows: [], categoryGuessId: "", errors: ["products.json غير صالح (ليس مصفوفة JSON سليمة)."] };
  }

  // مجلد products.json نفسه (وليس جذر الـzip بالضرورة) هو الأساس الذي تُبنى
  // عليه مسارات image_folder النسبية.
  const jsonDir = jsonEntry.name.includes("/")
    ? jsonEntry.name.slice(0, jsonEntry.name.lastIndexOf("/") + 1)
    : "";

  const rows: Row[] = [];
  const categoryTexts: string[] = [];

  for (const entry of parsed) {
    const nameAr = (entry.name_ar ?? "").trim();
    if (!nameAr) {
      errors.push(`منتج بلا name_ar (model: ${entry.model ?? "؟"}) — تم تجاهله.`);
      continue;
    }

    const row = newRow();
    row.nameAr = nameAr;
    row.purchasePrice =
      typeof entry.purchase_price_mad === "number" ? String(entry.purchase_price_mad) : "";
    row.salePrice = typeof entry.sale_price_mad === "number" ? String(entry.sale_price_mad) : "";
    row.minOrderQtyOverride =
      typeof entry.min_quantity === "number" ? String(entry.min_quantity) : "";

    if (typeof entry.stock === "number") {
      row.stockQuantity = String(entry.stock);
      row.stockRequired = false;
    } else {
      row.stockQuantity = "";
      row.stockRequired = true;
    }

    if (entry.category_ar) categoryTexts.push(entry.category_ar);

    // الصور: نضمن أن primary_image فالمقدمة، ثم نأخذ أول MAX_IMAGES_PER_PRODUCT
    // فقط — نفس حد الموقع، بلا اختراع أي ترتيب غير موجود فالملف.
    const imageNames = Array.isArray(entry.images) ? [...entry.images] : [];
    if (entry.primary_image && imageNames.includes(entry.primary_image)) {
      const idx = imageNames.indexOf(entry.primary_image);
      if (idx > 0) {
        imageNames.splice(idx, 1);
        imageNames.unshift(entry.primary_image);
      }
    }
    const selectedImageNames = imageNames.slice(0, MAX_IMAGES_PER_PRODUCT);

    for (const imgName of selectedImageNames) {
      const folder = entry.image_folder ? `${entry.image_folder.replace(/\/$/, "")}/` : "";
      const fullPath = `${jsonDir}${folder}${imgName}`;
      const imgEntry = zip.file(fullPath);
      if (!imgEntry) {
        errors.push(`${nameAr}: تعذّر إيجاد الصورة ${imgName} (${fullPath}).`);
        continue;
      }
      const mime = mimeFromFilename(imgName);
      if (!mime) {
        errors.push(`${nameAr}: صيغة صورة غير مدعومة (${imgName}).`);
        continue;
      }
      try {
        const blob = await imgEntry.async("blob");
        const file = new File([blob], imgName, { type: mime });
        const validationError = validateImageFile(file);
        if (validationError) {
          errors.push(`${nameAr} — ${imgName}: ${validationError}`);
          continue;
        }
        row.images.push({ clientId: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
      } catch {
        errors.push(`${nameAr}: فشل قراءة الصورة ${imgName}.`);
      }
    }

    rows.push(row);
  }

  // أفضل تصنيف مقترَح: أكثر نص category_ar تكراراً بين المنتجات (عادة نفس
  // التصنيف لكل الدفعة)، يبقى قابلاً للتغيير يدوياً قبل الحفظ دائماً.
  const categoryGuessId =
    categoryTexts.length > 0 ? guessCategoryId(categoryTexts[0], categoryOptions) : "";

  return { rows, categoryGuessId, errors };
}

function RowImagePicker({
  row,
  onChange,
  disabled,
}: {
  row: Row;
  onChange: (images: RowImage[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;

    setError(null);
    const validated: RowImage[] = [];
    for (const file of files) {
      const validationError = validateImageFile(file);
      if (validationError) {
        setError(validationError);
        continue;
      }
      validated.push({ clientId: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
    }
    onChange([...row.images, ...validated]);
  }

  function removeImage(clientId: string) {
    onChange(row.images.filter((img) => img.clientId !== clientId));
  }

  function makePrimary(clientId: string) {
    const target = row.images.find((img) => img.clientId === clientId);
    if (!target) return;
    onChange([target, ...row.images.filter((img) => img.clientId !== clientId)]);
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={handleFiles}
        className="w-full text-xs"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {row.images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {row.images.map((img, index) => (
            <div key={img.clientId} className="relative h-16 w-16 shrink-0">
              <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                {/* رابط blob محلي مؤقت (معاينة قبل الرفع فقط) — عمداً <img> عادية
                    وليس next/image، الذي لا يدعم روابط blob: (لا يمكن تحسينها
                    من الخادم أصلاً، وهي عابرة بطبيعتها). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              {index === 0 && (
                <span className="absolute -top-1 -right-1 rounded-full bg-brand-orange px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  رئيسية
                </span>
              )}
              <div className="mt-1 flex gap-1">
                {index !== 0 && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => makePrimary(img.clientId)}
                    className="text-[9px] text-brand-turquoise-dark underline disabled:opacity-50"
                  >
                    رئيسية
                  </button>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeImage(img.clientId)}
                  className="text-[9px] text-red-600 underline disabled:opacity-50"
                >
                  حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<RowStatus, { label: string; className: string } | null> = {
  idle: null,
  pending: { label: "جارٍ الحفظ…", className: "bg-neutral-200 text-neutral-700" },
  success: { label: "تم بنجاح", className: "bg-green-100 text-green-700" },
  duplicate: { label: "مكرر — لم يُنشأ", className: "bg-amber-100 text-amber-700" },
  error: { label: "فشل", className: "bg-red-100 text-red-700" },
};

export function BulkProductAddForm({ categories }: { categories: AdminCategory[] }) {
  const categoryOptions = buildCategoryOptions(categories);

  const [categoryId, setCategoryId] = useState("");
  const [stockQuantity, setStockQuantity] = useState("500");
  const [minOrderQty, setMinOrderQty] = useState("1");
  const [status, setStatus] = useState<"draft" | "published" | "out_of_stock">("published");
  const [sharedDescription, setSharedDescription] = useState("");

  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);

  const [isImportingZip, setIsImportingZip] = useState(false);
  const [zipErrors, setZipErrors] = useState<string[]>([]);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{ success: number; duplicate: number; failed: number } | null>(
    null
  );
  const [formError, setFormError] = useState<string | null>(null);

  function updateRow(clientId: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(clientId: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.clientId !== clientId) : prev));
  }

  function applyPaste() {
    const parsed = parsePastedRows(pasteText);
    if (parsed.length === 0) return;
    setRows((prev) => {
      const base = prev.length === 1 && isRowEmpty(prev[0]) ? [] : prev;
      return [...base, ...parsed];
    });
    setPasteText("");
    setShowPaste(false);
  }

  async function handleZipSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (zipInputRef.current) zipInputRef.current.value = "";
    if (!file) return;

    setFormError(null);
    setZipErrors([]);
    setIsImportingZip(true);
    try {
      const outcome = await parseZipFile(file, categoryOptions);
      if (outcome.rows.length === 0) {
        setZipErrors(
          outcome.errors.length > 0 ? outcome.errors : ["لم يُعثر على أي منتج صالح داخل الملف."]
        );
        return;
      }
      setRows((prev) => {
        const base = prev.length === 1 && isRowEmpty(prev[0]) ? [] : prev;
        return [...base, ...outcome.rows];
      });
      if (outcome.categoryGuessId) setCategoryId(outcome.categoryGuessId);
      setZipErrors(outcome.errors);
    } catch {
      setZipErrors(["تعذّر قراءة ملف ZIP. تأكد أنه ملف zip سليم."]);
    } finally {
      setIsImportingZip(false);
    }
  }

  async function uploadRowImages(productId: number, images: RowImage[]): Promise<string | null> {
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const target = await createImageUploadTarget(productId, image.file.type);
      if (target.error || !target.uploadUrl || !target.token || !target.objectPath) {
        return `فشل تحضير رفع صورة ${i + 1}: ${target.error ?? "خطأ غير معروف"}`;
      }
      try {
        const supabase = createSupabaseBrowserClient();
        const { error: uploadError } = await supabase.storage
          .from(PRODUCT_IMAGES_BUCKET)
          .uploadToSignedUrl(target.objectPath, target.token, image.file);
        if (uploadError) {
          return `فشل رفع صورة ${i + 1}.`;
        }
      } catch {
        return `فشل رفع صورة ${i + 1}.`;
      }

      const commitResult =
        i === 0
          ? await commitPrimaryImage(productId, target.objectPath)
          : await commitAdditionalImage(productId, target.objectPath, null);
      if (commitResult.error) {
        return `تم رفع صورة ${i + 1} لكن تعذّر حفظها: ${commitResult.error}`;
      }
    }
    return null;
  }

  async function handleSaveAll() {
    setFormError(null);
    if (!categoryId) {
      setFormError("اختر تصنيفاً أولاً.");
      return;
    }
    // فقط الأسطر التي لم تنجح بعد (success نهائية دائماً) — retry آمن لا
    // يُعيد إنشاء منتجات نجحت سابقاً.
    const pending = rows.filter((r) => r.status !== "success" && r.nameAr.trim());
    if (pending.length === 0) {
      setFormError("أضف سطراً واحداً على الأقل باسم منتج.");
      return;
    }

    // فحص مسبق: أي سطر كميته إجبارية (من ZIP بلا مخزون معروف) ولم تُملأ بعد
    // يمنع بدء الدفعة بأكملها — لا نبدأ حفظاً جزئياً بينما كمية منتج ما زالت
    // مجهولة، ولا نخترع رقماً بديلاً بصمت.
    const missingStock = pending.filter((r) => r.stockRequired && !r.stockQuantity.trim());
    if (missingStock.length > 0) {
      setFormError(
        `أدخل الكمية أولاً لهذه المنتجات قبل الحفظ: ${missingStock.map((r) => r.nameAr).join("، ")}`
      );
      return;
    }

    setIsSaving(true);
    setProgress({ done: 0, total: pending.length });
    let successCount = rows.filter((r) => r.status === "success").length;
    let duplicateCount = 0;
    let failedCount = 0;

    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      updateRow(row.clientId, { status: "pending", message: null });

      const minOverride = row.minOrderQtyOverride.trim()
        ? Number(row.minOrderQtyOverride)
        : Number(minOrderQty);
      const rowStock = row.stockQuantity.trim() ? Number(row.stockQuantity) : Number(stockQuantity);

      const result = await createBulkProduct({
        categoryId: Number(categoryId),
        nameAr: row.nameAr,
        purchasePrice: row.purchasePrice.trim() ? Number(row.purchasePrice) : null,
        salePrice: Number(row.salePrice || 0),
        minOrderQty: Number.isFinite(minOverride) && minOverride > 0 ? minOverride : 1,
        qtyIncrement: 1,
        stockQuantity: Number.isFinite(rowStock) && rowStock >= 0 ? rowStock : 0,
        status,
        descriptionAr: sharedDescription,
      });

      if (result.outcome === "success") {
        let message: string | null = `SKU: ${result.sku}`;
        if (row.images.length > 0) {
          const uploadError = await uploadRowImages(result.productId, row.images);
          if (uploadError) message = `${message} — ${uploadError}`;
        }
        updateRow(row.clientId, { status: "success", message, sku: result.sku });
        successCount += 1;
      } else if (result.outcome === "duplicate") {
        updateRow(row.clientId, { status: "duplicate", message: result.reason });
        duplicateCount += 1;
      } else {
        updateRow(row.clientId, { status: "error", message: result.error });
        failedCount += 1;
      }

      setProgress({ done: i + 1, total: pending.length });
    }

    setSummary({ success: successCount, duplicate: duplicateCount, failed: failedCount });
    setIsSaving(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border-2 border-dashed border-brand-orange/50 bg-orange-50/40 p-4">
        <h2 className="text-sm font-semibold text-neutral-800">استيراد دفعة منتجات (ZIP)</h2>
        <p className="mt-1 text-xs text-neutral-500">
          يقرأ الملف products.json وصوره مباشرة فالمتصفح ويعمر الأسطر أدناه تلقائياً — لا شيء يُحفظ
          فقاعدة البيانات حتى تضغط &quot;حفظ الكل&quot;.
        </p>
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          disabled={isImportingZip || isSaving}
          onChange={handleZipSelected}
          className="mt-3 w-full text-sm"
        />
        {isImportingZip && <p className="mt-2 text-xs text-neutral-500">جارٍ قراءة الملف…</p>}
        {zipErrors.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {zipErrors.map((err, i) => (
              <p key={i} className="text-xs text-amber-700">
                {err}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">القيم المشتركة للدفعة</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-700">التصنيف *</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={isSaving}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
            >
              <option value="">— اختر —</option>
              {categoryOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-700">حالة النشر</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              disabled={isSaving}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-700">الكمية الافتراضية (لأي سطر بلا كمية خاصة)</span>
            <input
              type="number"
              min={0}
              value={stockQuantity}
              onChange={(e) => setStockQuantity(e.target.value)}
              disabled={isSaving}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-neutral-700">أقل عدد للطلب (افتراضي)</span>
            <input
              type="number"
              min={1}
              value={minOrderQty}
              onChange={(e) => setMinOrderQty(e.target.value)}
              disabled={isSaving}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
            />
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-neutral-700">
              وصف مشترك (اختياري) — سيُلحَق به تلقائياً تنبيه المقارنة مع القطعة الأصلية
            </span>
            <textarea
              value={sharedDescription}
              onChange={(e) => setSharedDescription(e.target.value)}
              disabled={isSaving}
              rows={2}
              maxLength={800}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-4">
        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="text-sm font-semibold text-brand-turquoise-dark"
        >
          {showPaste ? "إخفاء" : "لصق بيانات من Excel/CSV"}
        </button>
        {showPaste && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-neutral-500">
              كل سطر: الاسم، ثمن الشراء، ثمن البيع، أقل عدد (اختياري) — مفصولة بـTab (لصق مباشر من
              Excel) أو فاصلة.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              placeholder={"موديل 1\t90\t150\nموديل 2\t80\t140\t2"}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-brand-turquoise focus:outline-none"
            />
            <button
              type="button"
              onClick={applyPaste}
              disabled={!pasteText.trim()}
              className="self-start rounded-full bg-brand-turquoise px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              تحويل إلى أسطر
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const badge = STATUS_BADGE[row.status];
          const stockMissing = row.stockRequired && !row.stockQuantity.trim();
          return (
            <div key={row.clientId} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-500">منتج {index + 1}</span>
                <div className="flex items-center gap-2">
                  {badge && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={isSaving || rows.length === 1}
                    onClick={() => removeRow(row.clientId)}
                    className="text-xs text-red-600 underline disabled:opacity-40"
                  >
                    حذف السطر
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  placeholder="اسم المنتج أو رقم الموديل *"
                  value={row.nameAr}
                  onChange={(e) => updateRow(row.clientId, { nameAr: e.target.value })}
                  disabled={isSaving || row.status === "success"}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none sm:col-span-2"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="ثمن الشراء"
                  value={row.purchasePrice}
                  onChange={(e) => updateRow(row.clientId, { purchasePrice: e.target.value })}
                  disabled={isSaving || row.status === "success"}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="ثمن البيع *"
                  value={row.salePrice}
                  onChange={(e) => updateRow(row.clientId, { salePrice: e.target.value })}
                  disabled={isSaving || row.status === "success"}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
                />
                <input
                  type="number"
                  min={1}
                  placeholder={`أقل عدد (افتراضي ${minOrderQty})`}
                  value={row.minOrderQtyOverride}
                  onChange={(e) => updateRow(row.clientId, { minOrderQtyOverride: e.target.value })}
                  disabled={isSaving || row.status === "success"}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
                />
                <input
                  type="number"
                  min={0}
                  placeholder={
                    row.stockRequired ? "الكمية * (مطلوبة، غير معروفة تلقائياً)" : `الكمية (افتراضي ${stockQuantity})`
                  }
                  value={row.stockQuantity}
                  onChange={(e) => updateRow(row.clientId, { stockQuantity: e.target.value })}
                  disabled={isSaving || row.status === "success"}
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                    stockMissing
                      ? "border-red-400 focus:border-red-500"
                      : "border-neutral-300 focus:border-brand-turquoise"
                  }`}
                />
              </div>
              {stockMissing && (
                <p className="mt-1 text-xs font-semibold text-red-600">
                  الكمية غير معروفة لهذا المنتج — أدخلها قبل الحفظ.
                </p>
              )}

              <div className="mt-2">
                <RowImagePicker
                  row={row}
                  onChange={(images) => updateRow(row.clientId, { images })}
                  disabled={isSaving || row.status === "success"}
                />
              </div>

              {row.message && (
                <p
                  className={`mt-2 text-xs ${row.status === "error" ? "text-red-600" : row.status === "duplicate" ? "text-amber-700" : "text-neutral-600"}`}
                >
                  {row.message}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addRow}
        disabled={isSaving}
        className="self-start rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
      >
        + إضافة سطر
      </button>

      {formError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{formError}</p>
      )}

      {isSaving && (
        <p className="text-sm text-neutral-600">
          جارٍ الحفظ: {progress.done} من {progress.total}…
        </p>
      )}

      {summary && !isSaving && (
        <div className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-700">
          النتيجة: <span className="font-semibold text-green-700">{summary.success} ناجح</span>،{" "}
          <span className="font-semibold text-amber-700">{summary.duplicate} مكرر</span>،{" "}
          <span className="font-semibold text-red-700">{summary.failed} فاشل</span>.
          {(summary.duplicate > 0 || summary.failed > 0) && (
            <span> يمكنك تعديل الأسطر المكرَّرة/الفاشلة والضغط على &quot;حفظ الكل&quot; مجدداً بأمان.</span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleSaveAll}
        disabled={isSaving}
        className="rounded-full bg-brand-orange px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isSaving ? "جارٍ الحفظ…" : "حفظ الكل"}
      </button>
    </div>
  );
}
