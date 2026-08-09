"use client";

import { useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { resolveImageUrl } from "@/lib/images";
import type { AdminProductImage } from "@/lib/queries/adminProducts";
import type { ImageActionState } from "@/app/admin/(protected)/products/imageActions";

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

function UploadForm({
  uploadAction,
  disabled,
}: {
  uploadAction: (prevState: ImageActionState, formData: FormData) => Promise<ImageActionState>;
  disabled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(uploadAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        formAction(formData);
        formRef.current?.reset();
      }}
      className="flex flex-col gap-2 rounded-xl border border-dashed border-neutral-300 p-3"
    >
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">إضافة صورة (JPG/PNG/WEBP، حتى 5 ميجابايت)</span>
        <input
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          disabled={disabled}
          className="w-full text-sm"
        />
      </label>
      <input
        name="altText"
        maxLength={200}
        placeholder="نص بديل (اختياري)"
        disabled={disabled}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
      />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={disabled || isPending}
        className="rounded-full bg-brand-orange px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "جارٍ الرفع…" : "رفع الصورة"}
      </button>
      {disabled && (
        <p className="text-xs text-neutral-500">وصلت للحد الأقصى (5 صور). احذف صورة لإضافة أخرى.</p>
      )}
    </form>
  );
}

export function ImageManager({
  images,
  imageUrlByPath = {},
  uploadAction,
  imagesWithActions,
  maxImages,
}: {
  images: AdminProductImage[];
  // storage_path → رابط جاهز للعرض، مُحلَّل من جهة الخادم — راجع
  // resolveProductImageUrl. عند غياب مسار (نادر) نرجع لـresolveImageUrl
  // التركيبي القديم كملاذ أخير.
  imageUrlByPath?: Record<string, string>;
  uploadAction: (prevState: ImageActionState, formData: FormData) => Promise<ImageActionState>;
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
      <UploadForm uploadAction={uploadAction} disabled={images.length >= maxImages} />
    </div>
  );
}
