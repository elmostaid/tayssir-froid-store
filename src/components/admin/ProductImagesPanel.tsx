"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { resolveImageUrl } from "@/lib/images";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { validateImageFile } from "@/lib/storage/imageValidation";
import type { AdminProductImage } from "@/lib/queries/adminProducts";
import type { ImageActionState, UploadTargetState } from "@/app/admin/(protected)/products/imageActions";

const PRODUCT_IMAGES_BUCKET = "product-images";

type ImageWithActions = {
  image: AdminProductImage;
  setPrimaryAction: () => Promise<{ error: string | null }>;
  deleteAction: () => Promise<{ error: string | null }>;
};

// لوحة صور المنتج الكاملة داخل كارت /admin/products: كل الصور thumbnails،
// الصورة الرئيسية مُعلَّمة بوضوح، وأزرار "تغيير الصورة الرئيسية" /
// "إضافة صورة" / "اجعلها رئيسية" / "حذف" لكل صورة إضافية.
//
// ممنوع تماماً: ملف الصورة لا يمرّ عبر أي Server Action إطلاقاً (لا FormData
// فيها File، ولا <form action={...}> يحتوي input الملف) — الرفع مباشر من
// المتصفح إلى Supabase Storage عبر رابط موقَّع (راجع createUploadTargetAction
// وimageActions.ts). كل input[type=file] هنا بلا خاصية name، ويُقرأ فقط عبر
// state/ref فمكوّن العميل. لا <form> يلف أياً من عناصر هذه اللوحة إطلاقاً —
// هي مستقلة تماماً عن فورم تعديل المنتج الكبير (سيبلينغ فـProductQuickEditRow)،
// وكل الأزرار هنا type="button" حتى لا يُغري أحدها submit لأي فورم أب مستقبلاً.
export function ProductImagesPanel({
  productNameAr,
  images,
  imageUrlByPath = {},
  canUploadImages,
  createUploadTargetAction,
  commitPrimaryUploadAction,
  commitAdditionalUploadAction,
  imagesWithActions,
}: {
  productNameAr: string;
  images: AdminProductImage[];
  // storage_path → رابط جاهز للعرض، مُحلَّل من جهة الخادم (محلي للصور
  // القديمة، أو Supabase Storage الحقيقي getPublicUrl للصور المرفوعة حديثاً
  // — راجع resolveProductImageUrl). عند غياب مسار فـهذا الكائن (نادر)، نرجع
  // لـresolveImageUrl التركيبي القديم كملاذ أخير بدل عدم عرض شيء إطلاقاً.
  imageUrlByPath?: Record<string, string>;
  // false عندما يتعذّر رفع أي صورة فعلياً فهذه البيئة (Supabase Storage غير
  // مُهيَّأ) — نُعطّل أزرار الرفع ونعرض رسالة واضحة بدل إتاحة محاولة ستفشل حتماً.
  canUploadImages: boolean;
  // binary الصورة لا يمرّ عبر Server Action/Vercel إطلاقاً فأي من الحالتين
  // (تغيير الصورة الرئيسية أو إضافة صورة): createUploadTargetAction تُرجع
  // رابط رفع موقَّع من Supabase Storage (نص فقط)، المتصفح يرفع الملف مباشرة
  // إليه (uploadToSignedUrl)، ثم commitPrimaryUploadAction/
  // commitAdditionalUploadAction تُحدِّث/تُنشئ سجل الصورة (نص فقط: objectPath
  // ± altText). راجع imageActions.ts.
  createUploadTargetAction: (contentType: string) => Promise<UploadTargetState>;
  commitPrimaryUploadAction: (objectPath: string) => Promise<ImageActionState>;
  commitAdditionalUploadAction: (objectPath: string, altText: string | null) => Promise<ImageActionState>;
  imagesWithActions: ImageWithActions[];
}) {
  const imageSrc = (storagePath: string) => imageUrlByPath[storagePath] ?? resolveImageUrl(storagePath);

  const ordered = [...images].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
  const secondaryWithActions = imagesWithActions.filter((entry) => !entry.image.is_primary);

  // رفع مباشر مشترك: يطلب رابطاً موقَّعاً، يرفع الملف من المتصفح مباشرة إلى
  // Supabase Storage، ثم يستدعي commit (نص فقط) لتحديث/إنشاء سجل الصورة.
  async function uploadFileDirectly(
    file: File,
    commit: (objectPath: string) => Promise<ImageActionState>
  ): Promise<ImageActionState> {
    const target = await createUploadTargetAction(file.type);
    if (target.error || !target.uploadUrl || !target.token || !target.objectPath) {
      return { error: target.error ?? "تعذّر تحضير الرفع. حاول مرة أخرى." };
    }

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .uploadToSignedUrl(target.objectPath, target.token, file);
      if (uploadError) {
        return { error: "تعذّر رفع الصورة. تحقق من الاتصال وحاول مرة أخرى." };
      }
    } catch {
      return { error: "تعذّر رفع الصورة. تحقق من الاتصال وحاول مرة أخرى." };
    }

    return commit(target.objectPath);
  }

  // --- تغيير الصورة الرئيسية: اختيار → معاينة → زر "حفظ" منفصل ---
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacePreviewUrl, setReplacePreviewUrl] = useState<string | null>(null);
  const [replaceResult, setReplaceResult] = useState<ImageActionState | null>(null);
  const [isReplacePending, startReplaceTransition] = useTransition();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  function handleReplaceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setReplaceResult(null);
    if (selected) {
      const validationError = validateImageFile(selected);
      if (validationError) {
        setReplaceResult({ error: validationError });
        if (replaceInputRef.current) replaceInputRef.current.value = "";
        return;
      }
    }
    setReplaceFile(selected);
    setReplacePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return selected ? URL.createObjectURL(selected) : null;
    });
  }

  function cancelReplace(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (replacePreviewUrl) URL.revokeObjectURL(replacePreviewUrl);
    setReplacePreviewUrl(null);
    setReplaceFile(null);
    setReplaceResult(null);
    if (replaceInputRef.current) replaceInputRef.current.value = "";
  }

  function handleReplaceSave(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!replaceFile) return;
    const file = replaceFile;
    startReplaceTransition(async () => {
      const result = await uploadFileDirectly(file, commitPrimaryUploadAction);
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

    const validationError = validateImageFile(selected);
    if (validationError) {
      setAddResult({ error: validationError });
      if (addInputRef.current) addInputRef.current.value = "";
      return;
    }

    startAddTransition(async () => {
      const result = await uploadFileDirectly(selected, (objectPath) =>
        commitAdditionalUploadAction(objectPath, null)
      );
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
              src={imageSrc(img.storage_path)}
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

      {!canUploadImages && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          رفع الصور غير مُفعَّل حالياً على هذه البيئة (تخزين Supabase غير مُهيَّأ). عرض الصور
          الحالية وحذفها وتحديد الرئيسية منها لا يزال يعمل بشكل طبيعي.
        </p>
      )}

      {/* تغيير الصورة الرئيسية: اختيار → معاينة → حفظ */}
      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
        <span className="text-xs font-semibold text-neutral-700">تغيير الصورة الرئيسية</span>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`min-h-11 rounded-full border border-neutral-300 bg-white px-4 py-2 text-center text-xs font-semibold text-neutral-700 ${
              canUploadImages ? "cursor-pointer" : "cursor-not-allowed opacity-50"
            }`}
          >
            اختيار صورة
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/*"
              onChange={handleReplaceFileChange}
              disabled={!canUploadImages}
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
          <label
            className={`min-h-11 rounded-full border border-neutral-300 bg-white px-4 py-2 text-center text-xs font-semibold text-neutral-700 ${
              canUploadImages && !isAddPending ? "cursor-pointer" : "cursor-not-allowed opacity-50"
            }`}
          >
            {isAddPending ? "جارٍ الرفع…" : "إضافة صورة"}
            <input
              ref={addInputRef}
              type="file"
              accept="image/*"
              onChange={handleAddFileChange}
              disabled={!canUploadImages || isAddPending}
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
                        src={imageSrc(image.storage_path)}
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
