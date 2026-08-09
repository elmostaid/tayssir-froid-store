"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { resolveImageUrl } from "@/lib/images";
import type { AdminProductImage } from "@/lib/queries/adminProducts";
import type { ImageActionState } from "@/app/admin/(protected)/products/imageActions";

type ImageWithActions = {
  image: AdminProductImage;
  setPrimaryAction: () => Promise<{ error: string | null }>;
  deleteAction: () => Promise<{ error: string | null }>;
};

// لوحة صور المنتج الكاملة داخل كارت /admin/products: كل الصور thumbnails،
// الصورة الرئيسية مُعلَّمة بوضوح، وأزرار "تغيير الصورة الرئيسية" /
// "إضافة صورة" / "اجعلها رئيسية" / "حذف" لكل صورة إضافية.
//
// كل اختيار ملف يُلتقَط كـFile حقيقي داخل حالة React عند onChange، ويُبنى
// FormData يدوياً منه ثم يُستدعى الإجراء مباشرة عبر startTransition — بدل
// الاعتماد على تسلسل input مخفي عبر form action الأصلي لـuseActionState
// (كان سبب خلل "Veuillez sélectionner un fichier": الملف الحقيقي أحياناً لا
// يصل عند وقت الإرسال). label حقيقي يلف input الملف بدل زر + ref.click()
// proxy — تفعيل مضمون فكل المتصفحات بما فيها الهاتف.
export function ProductImagesPanel({
  productNameAr,
  images,
  replacePrimaryAction,
  addImageAction,
  imagesWithActions,
}: {
  productNameAr: string;
  images: AdminProductImage[];
  replacePrimaryAction: (
    prevState: ImageActionState,
    formData: FormData
  ) => Promise<ImageActionState>;
  addImageAction: (
    prevState: ImageActionState,
    formData: FormData
  ) => Promise<ImageActionState>;
  imagesWithActions: ImageWithActions[];
}) {
  const ordered = [...images].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
  const secondaryWithActions = imagesWithActions.filter((entry) => !entry.image.is_primary);

  // --- تغيير الصورة الرئيسية: اختيار → معاينة → زر "حفظ" منفصل ---
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacePreviewUrl, setReplacePreviewUrl] = useState<string | null>(null);
  const [replaceResult, setReplaceResult] = useState<ImageActionState | null>(null);
  const [isReplacePending, startReplaceTransition] = useTransition();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  function handleReplaceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setReplaceResult(null);
    setReplaceFile(selected);
    setReplacePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return selected ? URL.createObjectURL(selected) : null;
    });
  }

  function cancelReplace() {
    if (replacePreviewUrl) URL.revokeObjectURL(replacePreviewUrl);
    setReplacePreviewUrl(null);
    setReplaceFile(null);
    setReplaceResult(null);
    if (replaceInputRef.current) replaceInputRef.current.value = "";
  }

  function handleReplaceSave() {
    if (!replaceFile) return;
    const fd = new FormData();
    fd.set("file", replaceFile);
    startReplaceTransition(async () => {
      const result = await replacePrimaryAction({ error: null }, fd);
      setReplaceResult(result);
      if (result.success) {
        if (replacePreviewUrl) URL.revokeObjectURL(replacePreviewUrl);
        setReplacePreviewUrl(null);
        setReplaceFile(null);
        if (replaceInputRef.current) replaceInputRef.current.value = "";
      }
    });
  }

  // --- إضافة صورة: اختيار → رفع فوري كصورة إضافية (is_primary=false) ---
  const [addResult, setAddResult] = useState<ImageActionState | null>(null);
  const [isAddPending, startAddTransition] = useTransition();
  const addInputRef = useRef<HTMLInputElement>(null);

  function handleAddFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    if (!selected) return;
    setAddResult(null);
    const fd = new FormData();
    fd.set("file", selected);
    startAddTransition(async () => {
      const result = await addImageAction({ error: null }, fd);
      setAddResult(result);
      if (addInputRef.current) addInputRef.current.value = "";
    });
  }

  // --- اجعلها رئيسية / حذف لكل صورة إضافية ---
  const [busyImageId, setBusyImageId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [isRowPending, startRowTransition] = useTransition();

  function runRowAction(
    imageId: number,
    action: () => Promise<{ error: string | null }>,
    confirmMessage?: string
  ) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setRowError(null);
    setBusyImageId(imageId);
    startRowTransition(async () => {
      const result = await action();
      if (result.error) setRowError(result.error);
      setBusyImageId(null);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      {/* شبكة كل صور المنتج الحالية */}
      <div className="flex flex-wrap gap-2">
        {ordered.length === 0 && (
          <p className="text-xs text-neutral-500">لا توجد صور لهذا المنتج بعد.</p>
        )}
        {ordered.map((img) => (
          <div
            key={img.id}
            className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-white"
          >
            <Image
              src={resolveImageUrl(img.storage_path)}
              alt={img.alt_text_ar ?? productNameAr}
              fill
              sizes="80px"
              className="object-contain"
            />
            {img.is_primary && (
              <span className="absolute inset-x-0 bottom-0 truncate bg-brand-orange/90 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
                الصورة الرئيسية
              </span>
            )}
          </div>
        ))}
      </div>

      {/* تغيير الصورة الرئيسية: اختيار → معاينة → حفظ */}
      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
        <span className="text-xs font-semibold text-neutral-700">تغيير الصورة الرئيسية</span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-h-11 cursor-pointer rounded-full border border-neutral-300 bg-white px-4 py-2 text-center text-xs font-semibold text-neutral-700">
            اختيار صورة
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/*"
              onChange={handleReplaceFileChange}
              className="sr-only"
            />
          </label>
          {replacePreviewUrl && (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-white">
              {/* معاينة محلية من ملف مختار (blob URL) — لا next/image لتفادي قيود مصدر blob محلي. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={replacePreviewUrl} alt="معاينة الصورة الجديدة" className="h-full w-full object-contain" />
            </div>
          )}
          {replaceFile && (
            <>
              <button
                type="button"
                onClick={handleReplaceSave}
                disabled={isReplacePending}
                className="min-h-11 rounded-full bg-brand-orange px-5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {isReplacePending ? "جارٍ الحفظ…" : "حفظ"}
              </button>
              <button
                type="button"
                onClick={cancelReplace}
                disabled={isReplacePending}
                className="min-h-11 rounded-full border border-neutral-300 px-4 text-xs text-neutral-600 disabled:opacity-60"
              >
                إلغاء
              </button>
            </>
          )}
        </div>
        {replaceResult?.error && <p className="text-xs text-red-600">{replaceResult.error}</p>}
        {replaceResult?.success && (
          <p className="text-xs text-brand-turquoise-dark">تم تغيير الصورة الرئيسية بنجاح.</p>
        )}
      </div>

      {/* إضافة صورة: اختيار → رفع فوري كصورة إضافية */}
      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-h-11 cursor-pointer rounded-full border border-neutral-300 bg-white px-4 py-2 text-center text-xs font-semibold text-neutral-700">
            {isAddPending ? "جارٍ الرفع…" : "إضافة صورة"}
            <input
              ref={addInputRef}
              type="file"
              accept="image/*"
              onChange={handleAddFileChange}
              disabled={isAddPending}
              className="sr-only"
            />
          </label>
        </div>
        {addResult?.error && <p className="text-xs text-red-600">{addResult.error}</p>}
        {addResult?.success && <p className="text-xs text-brand-turquoise-dark">تمت إضافة الصورة بنجاح.</p>}
      </div>

      {/* الصور الإضافية: اجعلها رئيسية / حذف */}
      {secondaryWithActions.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
          <span className="text-xs font-semibold text-neutral-700">الصور الإضافية</span>
          <div className="flex flex-col gap-2">
            {secondaryWithActions
              .sort((a, b) => a.image.sort_order - b.image.sort_order)
              .map(({ image, setPrimaryAction, deleteAction }) => {
                const isBusy = isRowPending && busyImageId === image.id;
                return (
                  <div
                    key={image.id}
                    className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2"
                  >
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded bg-neutral-100">
                      <Image
                        src={resolveImageUrl(image.storage_path)}
                        alt={image.alt_text_ar ?? productNameAr}
                        fill
                        sizes="48px"
                        className="object-contain"
                      />
                    </div>
                    <div className="flex flex-1 flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => runRowAction(image.id, setPrimaryAction)}
                        className="min-h-9 rounded-full border border-neutral-300 px-3 text-xs text-neutral-700 disabled:opacity-50"
                      >
                        اجعلها رئيسية
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => runRowAction(image.id, deleteAction, "حذف هذه الصورة؟")}
                        className="min-h-9 rounded-full border border-red-300 px-3 text-xs text-red-700 disabled:opacity-50"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
          {rowError && <p className="text-xs text-red-600">{rowError}</p>}
        </div>
      )}
    </div>
  );
}
