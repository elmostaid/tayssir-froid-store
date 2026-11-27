"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UploadOutcome } from "@/lib/settlements/uploadOutcome";

/**
 * رفع عشرات الفواتير دفعة وحدة (BigDelivery وOzonExpress مخلطين).
 *
 * - الملفات كيتصيفطو **واحد بواحد**: كل ملف كيتسجل فالقاعدة بمجرد ما يوصل،
 *   فانقطاع الإنترنت فالوسط ما كيضيّعش اللي تعالج.
 * - ملف ما تقراش كيتعلّم «مرفوض» والباقي كيكمل.
 * - انقطاع الشبكة: كنعاودو وحدنا جوج مرات، ومن بعد كيبان زر «عاود» للملفات
 *   اللي بقات. الإعادة آمنة: نفس الملف (نفس البصمة) ما كيتسجلش جوج مرات.
 */

type Item = {
  key: string;
  file: File;
  state: "queued" | "uploading" | "retrying" | "done" | "already" | "rejected" | "network";
  outcome?: UploadOutcome;
};

const CARRIER: Record<string, string> = { bigdelivery: "BigDelivery", ozonexpress: "OzonExpress" };
const RETRY_DELAYS = [2000, 5000];

class NetworkError extends Error {}

async function sendOne(file: File): Promise<UploadOutcome | "unauthorized"> {
  const body = new FormData();
  body.set("invoice", file);
  let response: Response;
  try {
    response = await fetch("/admin/settlements/upload", {
      method: "POST",
      body,
      headers: { "x-upload-mode": "json" },
      cache: "no-store",
    });
  } catch {
    throw new NetworkError();
  }
  if (response.status === 401 || response.redirected) return "unauthorized";
  if (response.status >= 500) throw new NetworkError();
  try {
    return (await response.json()) as UploadOutcome;
  } catch {
    throw new NetworkError();
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitOnline() {
  if (typeof navigator === "undefined" || navigator.onLine) return;
  await new Promise<void>((resolve) => window.addEventListener("online", () => resolve(), { once: true }));
}

export function UploadInvoiceForm() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionLost, setSessionLost] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ما تخرجش من الصفحة وسط الرفع بلا ما تعرف.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  function pick(files: FileList | null) {
    if (!files || running) return;
    const fresh = [...files].map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}-${file.size}`,
      file,
      state: "queued" as const,
    }));
    // ملفات جديدة كتزاد على اللائحة؛ نفس الملف (اسم + حجم) ما كيتزادش جوج مرات.
    setItems((list) => {
      const seen = new Set(list.map((it) => `${it.file.name}|${it.file.size}`));
      return [...list, ...fresh.filter((it) => !seen.has(`${it.file.name}|${it.file.size}`))];
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function run(only?: Item["state"][]) {
    if (running) return;
    setRunning(true);
    setSessionLost(false);
    const todo = items.filter((it) => (only ?? ["queued"]).includes(it.state));
    let changed = false;
    for (const it of todo) {
      update(it.key, { state: "uploading" });
      let result: UploadOutcome | "unauthorized" | null = null;
      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
          await waitOnline();
          result = await sendOne(it.file);
          break;
        } catch (e) {
          if (!(e instanceof NetworkError) || attempt === RETRY_DELAYS.length) break;
          update(it.key, { state: "retrying" });
          await wait(RETRY_DELAYS[attempt]);
        }
      }
      if (result === "unauthorized") {
        update(it.key, { state: "queued" });
        setSessionLost(true);
        break;
      }
      if (result === null) {
        update(it.key, { state: "network" });
        continue;
      }
      changed = true;
      update(it.key, {
        state: result.status === "created" ? "done" : result.status === "already" ? "already" : "rejected",
        outcome: result,
      });
    }
    setRunning(false);
    // الملخص فالصفحة (الجاهزة، الموافقة السريعة…) كيتحدّث بلا ما تضيع هاد اللائحة.
    if (changed) router.refresh();
  }

  const count = (s: Item["state"]) => items.filter((it) => it.state === s).length;
  const queued = count("queued");
  const failed = count("network");
  const finished = count("done") + count("already") + count("rejected");

  return (
    <section className="mt-4 rounded-xl border-2 border-brand-orange/30 bg-white p-4">
      <label className="block text-base font-bold text-neutral-800" htmlFor="invoices">
        رفع الفواتير
      </label>
      <p className="mt-1 text-xs text-neutral-500">
        BigDelivery وOzonExpress مخلطين — تقدر تختار بزاف ديال الملفات مرة وحدة. الشركة كتتعرف من الملف.
      </p>
      <input
        ref={inputRef}
        id="invoices"
        name="invoice"
        type="file"
        multiple
        accept="application/pdf,.pdf"
        disabled={running}
        onChange={(e) => pick(e.target.files)}
        className="mt-3 block w-full text-sm file:me-3 file:min-h-11 file:rounded-full file:border-0 file:bg-neutral-100 file:px-4 file:font-semibold"
      />

      {items.length > 0 && (
        <>
          <div className="mt-3" aria-live="polite">
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full bg-brand-orange transition-all"
                style={{ width: `${Math.round((finished / items.length) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs font-semibold text-neutral-700" data-testid="upload-progress">
              {finished} / {items.length} تعالجو
              {count("done") > 0 && ` · ${count("done")} جديدة`}
              {count("already") > 0 && ` · ${count("already")} سبق رفعها`}
              {count("rejected") > 0 && ` · ${count("rejected")} مرفوضة`}
              {failed > 0 && ` · ${failed} ما وصلاتش`}
            </p>
          </div>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs" data-testid="upload-list">
            {items.map((it) => (
              <UploadRow key={it.key} item={it} />
            ))}
          </ul>
        </>
      )}

      {sessionLost && (
        <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-semibold text-red-700">
          الجلسة سالات. دخل من جديد فنافذة أخرى، ومن بعد ضغط «كمّل» — اللي تعالج محفوظ.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {queued > 0 && (
          <button
            type="button"
            disabled={running}
            onClick={() => run()}
            className="min-h-12 w-full rounded-full bg-brand-orange px-5 text-base font-bold text-white disabled:bg-neutral-300"
          >
            {running ? "كنقرا الفواتير…" : finished > 0 ? `كمّل (${queued})` : `ارفع واقرا ${queued} فاتورة`}
          </button>
        )}
        {failed > 0 && !running && (
          <button
            type="button"
            onClick={() => run(["network"])}
            className="min-h-12 w-full rounded-full border-2 border-brand-orange px-5 text-base font-bold text-brand-orange"
          >
            عاود {failed} ما وصلاتش
          </button>
        )}
        {running && queued === 0 && <p className="text-center text-xs font-semibold text-neutral-600">كنقرا الفواتير…</p>}
        {!running && items.length > 0 && queued === 0 && failed === 0 && (
          <button
            type="button"
            onClick={() => setItems([])}
            className="min-h-11 w-full rounded-full bg-neutral-100 px-5 text-sm font-semibold text-neutral-700"
          >
            خوي اللائحة
          </button>
        )}
      </div>
    </section>
  );
}

function UploadRow({ item }: { item: Item }) {
  const o = item.outcome;
  const label = {
    queued: "فالانتظار",
    uploading: "كتتقرا…",
    retrying: "الشبكة طاحت — كنعاودو…",
    done: "✅ تسجلات",
    already: "↩︎ سبق رفعها",
    rejected: "❌ ترفضات",
    network: "⚠️ ما وصلاتش",
  }[item.state];
  const tone =
    item.state === "rejected" || item.state === "network"
      ? "border-red-200 bg-red-50"
      : item.state === "done" || item.state === "already"
        ? "border-emerald-200 bg-emerald-50"
        : "border-neutral-200 bg-neutral-50";
  const notes = o ? o.notes : [];
  return (
    <li className={`rounded-lg border p-2 ${tone}`} data-state={item.state}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-neutral-800" dir="ltr">
          {o && o.status !== "rejected" && o.invoiceNumber ? o.invoiceNumber : item.file.name}
        </span>
        <span className="shrink-0 font-bold">{label}</span>
      </div>
      {o && o.status !== "rejected" && (
        <p className="mt-0.5 text-neutral-600">
          {o.carrier ? CARRIER[o.carrier] ?? o.carrier : ""}
          {o.parcels !== undefined && ` · ${o.parcels} كرطونة`}
          {o.duplicates ? ` · ${o.duplicates} سبق حسابها` : ""}
        </p>
      )}
      {o && o.status === "rejected" && <p className="mt-0.5 text-red-700">{o.message}</p>}
      {notes.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-neutral-600">
            {o?.status === "rejected" ? "علاش؟" : `${notes.length} ملاحظة`}
          </summary>
          <ul className="mt-1 list-disc ps-4 text-neutral-700">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
