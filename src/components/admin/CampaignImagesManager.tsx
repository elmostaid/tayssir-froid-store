"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { processImageForUpload } from "@/lib/storage/imageProcessing";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  commitCampaignImage,
  createCampaignImageUploadTarget,
  resetCampaignImage,
} from "@/app/admin/(protected)/campaign-images/actions";

export type CampaignImageRow = {
  slotKey: string;
  label: string;
  imageSrc: string | null;
  isManual: boolean;
};

/** بطاقات الحملة تُعرض ≤ 430px على الهاتف: 900px تكفي شاشات Retina بهامش. */
const CAMPAIGN_IMAGE_OPTIONS = { maxLongEdge: 900, targetBytes: 150 * 1024 };

export function CampaignImagesManager({
  groups,
  canUpload,
}: {
  groups: { title: string; href: string; rows: CampaignImageRow[] }[];
  canUpload: boolean;
}) {
  return (
    <div className="mt-6 flex flex-col gap-8">
      {!canUpload && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          رفع الصور غير مُفعَّل في هذه البيئة.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.href}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold text-neutral-800">{group.title}</h2>
            <a href={group.href} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-turquoise-dark underline">
              فتح الصفحة
            </a>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.rows.map((row) => (
              <SlotCard key={row.slotKey} row={row} canUpload={canUpload} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SlotCard({ row, canUpload }: { row: CampaignImageRow; canUpload: boolean }) {
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
    const processed = await processImageForUpload(selected, CAMPAIGN_IMAGE_OPTIONS);
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
      const target = await createCampaignImageUploadTarget(row.slotKey, selected.type);
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
      const result = await commitCampaignImage(row.slotKey, target.objectPath);
      if (result.error) {
        setMessage({ error: true, text: result.error });
        return;
      }
      cancel();
      setMessage({ error: false, text: "تم حفظ الصورة. تظهر في الصفحة خلال دقيقة." });
      router.refresh();
    });
  }

  function reset() {
    startTransition(async () => {
      const result = await resetCampaignImage(row.slotKey);
      setMessage(result.error ? { error: true, text: result.error } : { error: false, text: "رجعت الصورة التلقائية." });
      router.refresh();
    });
  }

  const shown = preview ?? row.imageSrc;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {/* نفس قصّ البطاقة في الصفحة (4:3) — ما يُرى هنا هو ما يراه الزائر. */}
      <div className="relative aspect-[4/3] bg-neutral-100">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={row.label} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-neutral-400">بلا صورة</div>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-neutral-700">
          {preview ? "معاينة — لم تُحفظ" : row.isManual ? "صورة يدوية" : "تلقائية (من المنتجات)"}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="text-sm font-bold text-neutral-800">{row.label}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onSelect}
          disabled={!canUpload || isPending}
          className="text-xs"
        />
        <div className="flex flex-wrap gap-2">
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
          {!file && row.isManual && (
            <button type="button" onClick={reset} disabled={isPending} className="min-h-10 rounded-lg border border-neutral-300 px-3 text-xs">
              رجوع للصورة التلقائية
            </button>
          )}
        </div>
        {message && (
          <p className={message.error ? "text-xs text-red-600" : "text-xs text-green-700"}>{message.text}</p>
        )}
      </div>
    </div>
  );
}
