"use client";

import { useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { resolveImageUrl } from "@/lib/images";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { processImageForUpload } from "@/lib/storage/imageProcessing";
import type { AdminProductImage } from "@/lib/queries/adminProducts";
import type { ImageActionState, UploadTargetState } from "@/app/admin/(protected)/products/imageActions";

const PRODUCT_IMAGES_BUCKET = "product-images";
const initialState: ImageActionState = { error: null };

function ImageRow({
  image,
  imageUrl,
  isFirst,
  isLast,
  updateAltAction,
  deleteAction,
  setPrimaryAction,
  moveUpAction,
  moveDownAction,
}: {
  image: AdminProductImage;
  imageUrl: string;
  isFirst: boolean;
  isLast: boolean;
  updateAltAction: (
    prevState: ImageActionState,
    formData: FormData
  ) => Promise<ImageActionState>;
  deleteAction: () => Promise<{ error: string | null }>;
  setPrimaryAction: () => Promise<{ error: string | null }>;
  moveUpAction: () => Promise<{ error: string | null }>;
  moveDownAction: () => Promise<{ error: string | null }>;
}) {
  const [state, formAction, isPending] = useActionState(updateAltAction, initialState);
  const [isBusy, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  function runAction(action: () => Promise<{ error: string | null }>, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setActionError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setActionError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-3 sm:flex-row sm:items-start">
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
        <Image
          src={imageUrl}
          alt={image.alt_text_ar ?? ""}
          fill
          sizes="112px"
          className="object-contain"
        />
        {image.is_primary && (
          <span className="absolute right-1 top-1 rounded-full bg-brand-orange px-2 py-0.5 text-[10px] font-semibold text-white">
            رئيسية
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {/* هذا الفورم لنص alt فقط — لا input ملف فيه إطلاقاً. */}
        <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
          <input
            name="altText"
            maxLength={200}
            placeholder="نص بديل (اختياري)"
            defaultValue={image.alt_text_ar ?? ""}
            className="w-full flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-full bg-brand-turquoise px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            حفظ
          </button>
        </form>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}

        <div className="flex flex-wrap gap-2">
          {!image.is_primary && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => runAction(setPrimaryAction)}
              className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-700 disabled:opacity-50"
            >
              اجعلها رئيسية
            </button>
          )}
          <button
            type="button"
            disabled={isBusy || isFirst}
            onClick={() => runAction(moveUpAction)}
            className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-700 disabled:opacity-40"
          >
            ↑ للأعلى
          </button>
          <button
            type="button"
            disabled={isBusy || isLast}
            onClick={() => runAction(moveDownAction)}
            className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-700 disabled:opacity-40"
          >
            ↓ للأسفل
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => runAction(deleteAction, "حذف هذه الصورة؟")}
            className="rounded-full border border-red-300 px-3 py-1 text-xs text-red-700 disabled:opacity-50"
          >
            حذف
          </button>
        </div>
        {actionError && <p className="text-xs text-red-600">{actionError}</p>}
      </div>
    </div>
  );
}

// رفع صورة إضافية: لا <form action={...}> إطلاقاً ولا input[name="file"] —
// binary الصورة لا يمرّ عبر Server Action/Vercel أبداً. اختيار → رفع مباشر
// من المتصفح إلى Supabase Storage عبر رابط موقَّع (createUploadTargetAction)،
// ثم commitUploadAction (نص فقط: objectPath + altText) يُنشئ سجل الصورة.
function UploadForm({
  createUploadTargetAction,
  commitUploadAction,
  disabled,
}: {
  createUploadTargetAction: (contentType: string) => Promise<UploadTargetState>;
  commitUploadAction: (objectPath: string, altText: string | null) => Promise<ImageActionState>;
  disabled: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  const [state, setState] = useState<ImageActionState>(initialState);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // نفس المعالجة المستعملة في كل مسارات الرفع الأخرى (تصغير، اتجاه EXIF،
  // خلفية بيضاء، ثم JPEG بلا ميتاداتا) — الملف المحفوظ في الحالة هو
  // المعالَج، فما يُرفع لاحقاً هو ما عُولج بالضبط.
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setState(initialState);
    if (!selected) {
      setFile(null);
      return;
    }
    const processed = await processImageForUpload(selected);
    if (!processed.ok) {
      setState({ error: processed.error });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFile(null);
      return;
    }
    setFile(processed.file);
  }

  function handleUpload(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!file) {
      setState({ error: "اختر صورة أولاً." });
      return;
    }
    const selectedFile = file;
    const selectedAltText = altText;
    startTransition(async () => {
      const target = await createUploadTargetAction(selectedFile.type);
      if (target.error || !target.uploadUrl || !target.token || !target.objectPath) {
        setState({ error: target.error ?? "تعذّر تحضير الرفع. حاول مرة أخرى." });
        return;
      }

      try {
        const supabase = createSupabaseBrowserClient();
        const { error: uploadError } = await supabase.storage
          .from(PRODUCT_IMAGES_BUCKET)
          .uploadToSignedUrl(target.objectPath, target.token, selectedFile, {
            // اسم كل ملف UUID عشوائي، وتغيير صورة منتج يُنتج مساراً
            // جديداً كلياً — فالتخزين المؤقّت الطويل آمن هنا ولا يمكن
            // أن يُبقي زبوناً على صورة قديمة. بدون هذا السطر ترجع
            // Supabase الصور بـcache-control: no-cache، فيُعيد كل زائر
            // تنزيل كل صورة من الصفر في كل زيارة.
            cacheControl: "31536000",
          });
        if (uploadError) {
          setState({ error: "تعذّر رفع الصورة. تحقق من الاتصال وحاول مرة أخرى." });
          return;
        }
      } catch {
        setState({ error: "تعذّر رفع الصورة. تحقق من الاتصال وحاول مرة أخرى." });
        return;
      }

      const result = await commitUploadAction(target.objectPath, selectedAltText || null);
      setState(result);
      if (result.success) {
        setFile(null);
        setAltText("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-neutral-300 p-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">إضافة صورة (JPG/PNG/WEBP، حتى 5 ميجابايت)</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          disabled={disabled || isPending}
          className="w-full text-sm"
        />
      </label>
      <input
        value={altText}
        onChange={(e) => setAltText(e.target.value)}
        maxLength={200}
        placeholder="نص بديل (اختياري)"
        disabled={disabled || isPending}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
      />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.success && <p className="text-xs text-brand-turquoise-dark">تمت إضافة الصورة بنجاح.</p>}
      <button
        type="button"
        onClick={handleUpload}
        disabled={disabled || isPending || !file}
        className="rounded-full bg-brand-orange px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "جارٍ الرفع…" : "رفع الصورة"}
      </button>
      {disabled && (
        <p className="text-xs text-neutral-500">وصلت للحد الأقصى (5 صور). احذف صورة لإضافة أخرى.</p>
      )}
    </div>
  );
}

export function ImageManager({
  images,
  imageUrlByPath = {},
  createUploadTargetAction,
  commitUploadAction,
  imagesWithActions,
  maxImages,
}: {
  images: AdminProductImage[];
  // storage_path → رابط جاهز للعرض، مُحلَّل من جهة الخادم — راجع
  // resolveProductImageUrl. عند غياب مسار (نادر) نرجع لـresolveImageUrl
  // التركيبي القديم كملاذ أخير.
  imageUrlByPath?: Record<string, string>;
  createUploadTargetAction: (contentType: string) => Promise<UploadTargetState>;
  commitUploadAction: (objectPath: string, altText: string | null) => Promise<ImageActionState>;
  imagesWithActions: {
    image: AdminProductImage;
    updateAltAction: (
      prevState: ImageActionState,
      formData: FormData
    ) => Promise<ImageActionState>;
    deleteAction: () => Promise<{ error: string | null }>;
    setPrimaryAction: () => Promise<{ error: string | null }>;
    moveUpAction: () => Promise<{ error: string | null }>;
    moveDownAction: () => Promise<{ error: string | null }>;
  }[];
  maxImages: number;
}) {
  const ordered = [...imagesWithActions].sort((a, b) => a.image.sort_order - b.image.sort_order);

  return (
    <div className="flex flex-col gap-3">
      {images.length === 0 && (
        <p className="text-sm text-neutral-500">لا توجد صور لهذا المنتج بعد.</p>
      )}
      {ordered.map((entry, index) => (
        <ImageRow
          key={entry.image.id}
          image={entry.image}
          imageUrl={imageUrlByPath[entry.image.storage_path] ?? resolveImageUrl(entry.image.storage_path)}
          isFirst={index === 0}
          isLast={index === ordered.length - 1}
          updateAltAction={entry.updateAltAction}
          deleteAction={entry.deleteAction}
          setPrimaryAction={entry.setPrimaryAction}
          moveUpAction={entry.moveUpAction}
          moveDownAction={entry.moveDownAction}
        />
      ))}
      <UploadForm
        createUploadTargetAction={createUploadTargetAction}
        commitUploadAction={commitUploadAction}
        disabled={images.length >= maxImages}
      />
    </div>
  );
}
