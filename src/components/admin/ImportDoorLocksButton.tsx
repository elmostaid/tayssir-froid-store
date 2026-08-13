"use client";

import { useState, useTransition } from "react";
import {
  importDoorLocksBatch,
  type DoorLockImportRowResult,
  type DoorLockImportSummary,
} from "@/app/admin/(protected)/tools/import-door-locks/actions";

export function ImportDoorLocksButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DoorLockImportSummary | null>(null);
  const [rows, setRows] = useState<DoorLockImportRowResult[]>([]);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await importDoorLocksBatch();
      if (result.error) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      setRows(result.rows);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full rounded-full bg-brand-orange px-6 py-4 text-base font-semibold text-white disabled:opacity-60 sm:w-auto"
      >
        {isPending ? "جارٍ الاستيراد…" : "استيراد 28 قفل باب"}
      </button>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
      )}

      {summary && (
        <div className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700">
          <p className="font-semibold text-neutral-800">النتيجة:</p>
          <ul className="mt-2 flex flex-col gap-1">
            <li>منتجات مضافة الآن: <span className="font-semibold text-green-700">{summary.productsInserted}</span></li>
            <li>منتجات موجودة مسبقاً (لم تُلمَس): <span className="font-semibold text-neutral-600">{summary.productsAlreadyExisted}</span></li>
            <li>صور مضافة الآن: <span className="font-semibold text-green-700">{summary.imagesInserted}</span></li>
            <li>صور موجودة مسبقاً (لم تُلمَس): <span className="font-semibold text-neutral-600">{summary.imagesAlreadyExisted}</span></li>
            {summary.failures > 0 && (
              <li>فشل: <span className="font-semibold text-red-700">{summary.failures}</span></li>
            )}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-neutral-500">
          {rows.map((row) => (
            <div key={row.sku} className="flex items-center justify-between gap-2 border-b border-neutral-100 py-1">
              <span dir="ltr" className="font-mono">{row.sku}</span>
              <span>
                {row.error
                  ? `فشل: ${row.error}`
                  : row.productOutcome === "inserted"
                    ? `أُضيف (${row.imagesInserted} صورة جديدة)`
                    : `موجود مسبقاً (${row.imagesInserted} صورة جديدة، ${row.imagesAlreadyExisted} موجودة)`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
