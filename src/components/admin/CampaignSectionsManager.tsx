"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { processImageForUpload } from "@/lib/storage/imageProcessing";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  addSectionProduct,
  commitSectionImage,
  createSectionImageUploadTarget,
  moveSectionProduct,
  removeSectionProduct,
  resetSectionImage,
  searchSectionProducts,
  type SectionCandidate,
} from "@/app/admin/(protected)/campaign-images/sectionActions";

/** بطاقة المنتج في القسم مربّعة وبعرض نصف الشاشة على الهاتف — نفس «الأكثر طلباً». */
const DISPLAY_IMAGE_OPTIONS = { maxLongEdge: 720, targetBytes: 110 * 1024 };

export type SectionRowItem = {
  productId: number;
  name: string;
  sku: string;
  price: string;
  family: string;
  source: "manual" | "auto";
  /** صورة المنتج في الكتالوج (للمقارنة). */
  productImageSrc: string | null;
  /** صورة العرض الخاصة إن وُجدت. */
  displayImageSrc: string | null;
};

export type SectionGroup = {
  slotKey: string;
  label: string;
  items: SectionRowItem[];
  manualCount: number;
};

type Message = { error: boolean; text: string } | null;

export function CampaignSectionsManager({
  sections,
  size,
  canUpload,
}: {
  sections: SectionGroup[];
  size: number;
  canUpload: boolean;
}) {
  return (
    <div className="mt-4 space-y-6">
      {sections.map((section) => (
        <SectionPanel key={section.slotKey} section={section} size={size} canUpload={canUpload} />
      ))}
    </div>
  );
}

function SectionPanel({ section, size, canUpload }: { section: SectionGroup; size: number; canUpload: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SectionCandidate[] | null>(null);

  function run(action: () => Promise<{ error: string | null }>, success: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.error ? { error: true, text: result.error } : { error: false, text: success });
      if (!result.error) router.refresh();
    });
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const found = await searchSectionProducts(section.slotKey, query);
      if ("error" in found) {
        setMessage({ error: true, text: found.error });
        setResults(null);
        return;
      }
      setResults(found);
    });
  }

  const shownIds = new Set(section.items.map((item) => item.productId));
  const manualFamilies = new Set(section.items.filter((item) => item.source === "manual").map((item) => item.family));
  const full = section.manualCount >= size;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-3" data-section-slot={section.slotKey}>
      <h3 className="font-bold text-neutral-800">{section.label}</h3>
      <p className="mt-1 text-xs text-neutral-500">
        مختار يدوياً: {section.manualCount} من {size}.{" "}
        {section.manualCount < size && "الباقي يُكمَل تلقائياً بالأكثر طلباً، بقطعة واحدة من كل صنف."}
      </p>

      <ol className="mt-3 space-y-3">
        {section.items.map((item, index) => (
          <li
            key={item.productId}
            className="rounded-lg border border-neutral-100 p-2"
            data-section-item={item.productId}
            data-source={item.source}
          >
            <div className="flex items-start gap-3">
              <span className="mt-1 w-5 shrink-0 text-center text-sm font-bold text-neutral-500">{index + 1}</span>
              <span className="relative block size-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
                {(item.displayImageSrc ?? item.productImageSrc) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(item.displayImageSrc ?? item.productImageSrc) as string}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-neutral-800">{item.name}</p>
                <p className="text-xs text-neutral-500" dir="ltr">
                  {item.sku} · {item.price} DH
                </p>
                <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700">الصنف: {item.family}</span>
                  <span
                    className={
                      item.source === "manual"
                        ? "rounded-full bg-brand-turquoise-tint px-2 py-0.5 font-bold text-brand-turquoise-dark"
                        : "rounded-full bg-amber-50 px-2 py-0.5 text-amber-800"
                    }
                  >
                    {item.source === "manual" ? "مختار يدوياً" : "تلقائي (الأكثر طلباً)"}
                  </span>
                </p>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {item.source === "manual" ? (
                <>
                  <RankControl
                    slotKey={section.slotKey}
                    productId={item.productId}
                    current={index + 1}
                    max={section.manualCount}
                    disabled={isPending}
                    onMove={(rank) => run(() => moveSectionProduct(section.slotKey, item.productId, rank), "تم تغيير الترتيب.")}
                  />
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => removeSectionProduct(section.slotKey, item.productId), "أُزيل من القسم.")}
                    className="min-h-10 rounded-lg border border-red-200 px-3 text-xs text-red-700"
                  >
                    إزالة
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={isPending || full}
                  onClick={() => run(() => addSectionProduct(section.slotKey, item.productId), "ثُبِّت في القسم.")}
                  className="min-h-10 rounded-lg border border-neutral-300 px-3 text-xs"
                >
                  تثبيت هنا
                </button>
              )}
            </div>

            <SectionDisplayImageControl
              slotKey={section.slotKey}
              productId={item.productId}
              productName={item.name}
              displayImageSrc={item.displayImageSrc}
              canUpload={canUpload}
            />
          </li>
        ))}
      </ol>

      <form onSubmit={search} className="mt-4 flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث بالاسم أو الرمز (مثلاً: موطور، قفل…)"
          aria-label={`بحث عن منتج لقسم ${section.label}`}
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 text-sm"
        />
        <button type="submit" disabled={isPending} className="min-h-10 rounded-lg bg-neutral-800 px-4 text-sm font-bold text-white">
          بحث
        </button>
      </form>

      {results && (
        <ul className="mt-2 max-h-80 divide-y overflow-y-auto rounded-lg border border-neutral-200" data-section-results>
          {results.length === 0 && <li className="p-2 text-xs text-neutral-500">لا نتائج في هذا النوع.</li>}
          {results.map((candidate) => {
            const inSection = shownIds.has(candidate.id) && !section.items.some((item) => item.productId === candidate.id && item.source === "auto");
            const clash = !inSection && manualFamilies.has(candidate.family);
            return (
              <li key={candidate.id} className="flex items-center gap-2 p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-800">{candidate.name}</p>
                  <p className="text-[11px] text-neutral-500">
                    <span dir="ltr">{candidate.sku}</span> · {candidate.price} DH · الصنف: {candidate.family} · طُلب {candidate.units}
                    {(candidate.status === "out_of_stock" || candidate.stock <= 0) && " · نافد"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPending || inSection || clash || full}
                  title={clash ? `يوجد «${candidate.family}» في القسم` : undefined}
                  onClick={() => run(() => addSectionProduct(section.slotKey, candidate.id), "أُضيف للقسم.")}
                  className="min-h-9 shrink-0 rounded-lg bg-brand-orange px-3 text-xs font-bold text-white disabled:bg-neutral-300"
                >
                  {inSection ? "في القسم" : clash ? "صنف مكرّر" : "إضافة"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {message && (
        <p className={message.error ? "mt-2 text-sm text-red-600" : "mt-2 text-sm text-green-700"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

function RankControl({
  slotKey,
  productId,
  current,
  max,
  disabled,
  onMove,
}: {
  slotKey: string;
  productId: number;
  current: number;
  max: number;
  disabled: boolean;
  onMove: (rank: number) => void;
}) {
  const [value, setValue] = useState(String(current));
  const id = `section-rank-${slotKey.replace(/[^a-z0-9]/gi, "-")}-${productId}`;
  return (
    <span className="flex items-center gap-1">
      <label htmlFor={id} className="text-xs text-neutral-600">
        المرتبة
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="min-h-10 w-14 rounded-lg border border-neutral-300 px-2 text-center text-sm"
      />
      <button
        type="button"
        disabled={disabled || Number(value) === current}
        onClick={() => onMove(Number(value))}
        className="min-h-10 rounded-lg border border-neutral-300 px-3 text-xs"
      >
        نقل
      </button>
    </span>
  );
}

/** صورة العرض لمنتج في القسم: تظهر في /washing-machines وحدها، صورة الكتالوج لا تتغيّر. */
function SectionDisplayImageControl({
  slotKey,
  productId,
  productName,
  displayImageSrc,
  canUpload,
}: {
  slotKey: string;
  productId: number;
  productName: string;
  displayImageSrc: string | null;
  canUpload: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
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
      const target = await createSectionImageUploadTarget(slotKey, productId, selected.type);
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
      const result = await commitSectionImage(slotKey, productId, target.objectPath);
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
      const result = await resetSectionImage(slotKey, productId);
      setMessage(result.error ? { error: true, text: result.error } : { error: false, text: "رجعت صورة المنتج." });
      router.refresh();
    });
  }

  return (
    <div className="mt-2 rounded-lg bg-neutral-50 p-2" data-section-image-control={productId}>
      <p className="text-xs font-bold text-neutral-700">
        صورة العرض في هذا القسم
        <span className="mr-1 font-normal text-neutral-500">
          {preview ? "— معاينة، لم تُحفظ" : displayImageSrc ? "— صورة خاصة" : "— صورة المنتج"}
        </span>
      </p>
      <div className="mt-1 flex items-center gap-2">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onSelect}
          disabled={!canUpload || isPending}
          aria-label={`اختيار صورة عرض لـ${productName}`}
          className="w-full text-xs"
        />
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
