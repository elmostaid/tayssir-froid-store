"use client";

import { useState, useTransition } from "react";
import {
  importDoorLocksBatch,
  type DoorLockImportSummary,
} from "@/app/admin/(protected)/tools/import-door-locks/actions";

export function ImportDoorLocksButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DoorLockImportSummary | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await importDoorLocksBatch();
      if (result.error) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
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
        {isPending ? "جارٍ الاستيراد…" : "استيراد أقفال الباب الناقصة"}
      </button>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
      )}

      {summary && (
        <div className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700" dir="ltr">
          <p>
            Products: <span className="font-semibold text-neutral-800">{summary.productsPresent}/{summary.productsTarget}</span>
          </p>
          <p>
            Images: <span className="font-semibold text-neutral-800">{summary.imagesPresent}/{summary.imagesTarget}</span>
          </p>
          {summary.failures.length > 0 && (
            <div className="mt-2">
              <p className="font-semibold text-red-700">Failures ({summary.failures.length}):</p>
              <ul className="mt-1 flex flex-col gap-1">
                {summary.failures.map((f) => (
                  <li key={f.sku} className="text-xs text-red-700">
                    {f.sku}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
