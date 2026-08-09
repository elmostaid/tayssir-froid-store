"use client";

import { useRef } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { resolveImageUrl } from "@/lib/images";
import type { ImageActionState } from "@/app/admin/(protected)/products/imageActions";

const initialState: ImageActionState = { error: null };

export function ChangePrimaryImageForm({
  action,
  currentImagePath,
  currentImageAlt,
}: {
  action: (prevState: ImageActionState, formData: FormData) => Promise<ImageActionState>;
  currentImagePath: string | null;
  currentImageAlt: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:flex-row sm:items-center">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {currentImagePath ? (
          <Image
            src={resolveImageUrl(currentImagePath)}
            alt={currentImageAlt}
            fill
            sizes="96px"
            className="object-contain"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-center text-[10px] text-neutral-400">
            بدون صورة
          </span>
        )}
      </div>

      <form
        ref={formRef}
        action={(formData) => {
          formAction(formData);
          formRef.current?.reset();
        }}
        className="flex flex-1 flex-col gap-2"
      >
        <span className="text-sm font-semibold text-neutral-800">تغيير الصورة</span>
        <input
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="w-full text-sm file:ms-2 file:rounded-full file:border-0 file:bg-brand-turquoise-tint file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-turquoise-dark"
        />
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        {!state.error && state.success && (
          <p className="text-xs text-brand-turquoise-dark">تم تغيير الصورة بنجاح.</p>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-full bg-brand-orange px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isPending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
      </form>
    </div>
  );
}
