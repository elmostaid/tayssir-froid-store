"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { resolveImageUrl } from "@/lib/images";
import type { ImageActionState } from "@/app/admin/(protected)/products/imageActions";

const initialState: ImageActionState = { error: null };

export function ChangeProductImageForm({
  action,
  currentImagePath,
  currentImageAlt,
}: {
  action: (prevState: ImageActionState, formData: FormData) => Promise<ImageActionState>;
  currentImagePath: string | null;
  currentImageAlt: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // بعد نجاح الحفظ، نلغي المعاينة المحلية (الصورة الجديدة الحقيقية القادمة
  // من الخادم عبر currentImagePath ستحل محلها تلقائياً بعد revalidatePath).
  // نضبط الحالة أثناء الـrender نفسه (نمط React الموصى به لتفادي setState
  // داخل useEffect) بمقارنة state الحالية بآخر state عولجت فعلياً.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setSelectedFileName(null);
    }
  }

  // مزامنة خارجية حقيقية: تصفير قيمة input[type=file] غير المتحكَّم به فـ
  // DOM بعد أن أصبحت previewUrl فارغة (نجاح الحفظ)، حتى يقبل نفس الملف
  // مجدداً إذا اختير مرة أخرى.
  useEffect(() => {
    if (previewUrl === null && inputRef.current) {
      inputRef.current.value = "";
    }
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return selected ? URL.createObjectURL(selected) : null;
    });
    setSelectedFileName(selected?.name ?? null);
  }

  const displaySrc = previewUrl ?? (currentImagePath ? resolveImageUrl(currentImagePath) : null);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:flex-row sm:items-center">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {displaySrc ? (
          previewUrl ? (
            // معاينة محلية من ملف مختار (blob URL) — لا next/image لتفادي قيود
            // تحسين الصور على مصدر blob: محلي.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displaySrc} alt="معاينة الصورة الجديدة" className="h-full w-full object-contain" />
          ) : (
            <Image
              src={displaySrc}
              alt={currentImageAlt}
              fill
              sizes="96px"
              className="object-contain"
            />
          )
        ) : (
          <span className="flex h-full w-full items-center justify-center text-center text-[10px] text-neutral-400">
            بدون صورة
          </span>
        )}
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-1 flex-col gap-2"
      >
        <span className="text-sm font-semibold text-neutral-800">تغيير الصورة</span>

        <input
          ref={inputRef}
          name="file"
          type="file"
          accept="image/*"
          required
          onChange={handleFileChange}
          className="sr-only"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700"
          >
            تغيير الصورة
          </button>
          {selectedFileName && (
            <span className="truncate text-xs text-neutral-500">{selectedFileName}</span>
          )}
        </div>

        {previewUrl && (
          <button
            type="submit"
            disabled={isPending}
            className="self-start rounded-full bg-brand-orange px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isPending ? "جارٍ الحفظ…" : "حفظ الصورة"}
          </button>
        )}

        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        {!state.error && state.success && (
          <p className="text-xs text-brand-turquoise-dark">تم تغيير الصورة بنجاح.</p>
        )}
      </form>
    </div>
  );
}
