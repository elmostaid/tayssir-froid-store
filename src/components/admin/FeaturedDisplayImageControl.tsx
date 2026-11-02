"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { processImageForUpload } from "@/lib/storage/imageProcessing";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  commitFeaturedImage,
  createFeaturedImageUploadTarget,
  resetFeaturedImage,
} from "@/app/admin/(protected)/featured/displayImageActions";

/**
 * بطاقة «الأكثر طلباً» مربّعة وبعرض نصف الشاشة على الهاتف (≈ 180px): 720px
 * تكفي شاشات Retina وتبقى خفيفة — 9 بطاقات فوق الطيّة وما يليها.
 */
const DISPLAY_IMAGE_OPTIONS = { maxLongEdge: 720, targetBytes: 110 * 1024 };

/**
 * صورة العرض لمنتج واحد في «الأكثر طلباً»: رفع من الهاتف، حفظ، أو رجوع
 * لصورة المنتج. الصورة تظهر في هذا القسم من الصفحة الرئيسية وحده.
 */
export function FeaturedDisplayImageControl({
  productId,
  productName,
  displayImageSrc,
  canUpload,
}: {
  productId: number;
  productName: string;
  /** صورة العرض الحالية إن وُجدت، وإلا null (= صورة المنتج). */
  displayImageSrc: string | null;
  canUpload: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSelect(event: React.ChangeEvent<HTMLInputElement>) {
    setMessage(null);
    const selected = event.target.files?.[0];
    if (!selected) return;
    const processed = await processImageForUpload(selected, DISPLAY_IMAGE_OPTIONS);
    if (!processed.ok) {
      setMessage({ error: true, text: processed.error });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(processed.file);
    setPreview(URL.createObjectURL(processed.file));
  }

  function cancel() {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function save() {
    if (!file) return;
    const selected = file;
    startTransition(async () => {
      const target = await createFeaturedImageUploadTarget(productId, selected.type);
      if (target.error || !target.token || !target.objectPath) {
        setMessage({ error: true, text: target.error ?? "تعذّر تحضير الرفع." });
        return;
      }
      try {
        const { error } = await createSupabaseBrowserClient()
          .storage.from("product-images")
          .uploadToSignedUrl(target.objectPath, target.token, selected, { cacheControl: "31536000" });
        if (error) {
          setMessage({ error: true, text: "تعذّر رفع الصورة. تحقق من الاتصال وحاول مرة أخرى." });
          return;
        }
      } catch {
        setMessage({ error: true, text: "تعذّر رفع الصورة. تحقق من الاتصال وحاول مرة أخرى." });
        return;
      }
      const result = await commitFeaturedImage(productId, target.objectPath);
      if (result.error) {
        setMessage({ error: true, text: result.error });
        return;
      }
      cancel();
      setMessage({ error: false, text: "تم حفظ صورة العرض." });
      router.refresh();
    });
  }

  function reset() {
    startTransition(async () => {
      const result = await resetFeaturedImage(productId);
      setMessage(result.error ? { error: true, text: result.error } : { error: false, text: "رجعت صورة المنتج." });
      router.refresh();
    });
  }

  const shown = preview ?? displayImageSrc;

  return (
    <div className="mt-2 rounded-lg bg-neutral-50 p-2" data-featured-image-control={productId}>
      <div className="flex items-center gap-3">
        {/* نفس قصّ البطاقة في الصفحة الرئيسية (مربّع). */}
        <span className="relative block size-16 shrink-0 overflow-hidden rounded-lg bg-neutral-200">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt={`صورة عرض ${productName}`} className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center p-1 text-center text-[10px] text-neutral-500">
              صورة المنتج
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-neutral-700">
            صورة العرض في الصفحة الرئيسية
            <span className="mr-1 font-normal text-neutral-500">
              {preview ? "— معاينة، لم تُحفظ" : displayImageSrc ? "— صورة خاصة" : "— صورة المنتج"}
            </span>
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onSelect}
            disabled={!canUpload || isPending}
            aria-label={`اختيار صورة عرض لـ${productName}`}
            className="mt-1 w-full text-xs"
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {file && (
          <>
            <button type="button" onClick={save} disabled={isPending} className="min-h-10 rounded-lg bg-brand-orange px-4 text-sm font-bold text-white disabled:opacity-60">
              {isPending ? "جارٍ الحفظ…" : "حفظ الصورة"}
            </button>
            <button type="button" onClick={cancel} disabled={isPending} className="min-h-10 rounded-lg border border-neutral-300 px-3 text-sm">
              إلغاء
            </button>
          </>
        )}
        {!file && displayImageSrc && (
          <button type="button" onClick={reset} disabled={isPending} className="min-h-10 rounded-lg border border-neutral-300 px-3 text-xs">
            رجوع لصورة المنتج
          </button>
        )}
      </div>
      {message && <p className={message.error ? "mt-1 text-xs text-red-600" : "mt-1 text-xs text-green-700"}>{message.text}</p>}
    </div>
  );
}
