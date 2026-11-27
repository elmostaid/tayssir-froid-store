"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * «اختار جميع الجاهزة» — المالك يراجع الملخص ثم يختار الكل بضغطة واحدة، بلا
 * علامة على كل طلبية. الطلبيات ذات الثقة المتوسطة لا تُعلَّم وحدها؛ هذا الزر
 * هو اختيارها الصريح دفعةً واحدة.
 */
export function SelectAll({ name, label }: { name: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"all" | "some" | "none">("none");

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const sync = () => {
      const boxes = [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
      const checked = boxes.filter((b) => b.checked).length;
      setState(checked === 0 ? "none" : checked === boxes.length ? "all" : "some");
    };
    sync();
    form.addEventListener("change", sync);
    return () => form.removeEventListener("change", sync);
  }, [name]);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);

  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm font-semibold text-neutral-800">
      <input
        ref={ref}
        type="checkbox"
        checked={state === "all"}
        onChange={(e) => {
          const form = e.currentTarget.closest("form");
          form?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((b) => {
            b.checked = e.currentTarget.checked;
          });
          form?.dispatchEvent(new Event("change", { bubbles: true }));
        }}
        className="h-5 w-5 accent-brand-turquoise"
      />
      {label}
    </label>
  );
}

const APPLY_INPUTS = ["ready", "quick_cost", "quick_round", "approve", "return", "inv"]
  .map((n) => `input[name="${n}"]:checked`)
  .join(", ");

/** زرّ التطبيق يعرض عدد المختار، ويتعطّل إن لم يُختر شيء أو أثناء المعالجة. */
export function ApplyButton({
  idle = "اختار الطلبيات أولاً",
  template = "طبّق على {n} طلبية",
}: {
  idle?: string;
  /** النص مع العدد — نص (ماشي دالة) حيت كيتصيفط من مكوّن الخادم. */
  template?: string;
} = {}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(0);
  const { pending } = useFormStatus();

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const sync = () =>
      setCount(form.querySelectorAll(APPLY_INPUTS).length);
    sync();
    form.addEventListener("change", sync);
    return () => form.removeEventListener("change", sync);
  }, []);

  return (
    <button
      ref={ref}
      type="submit"
      disabled={pending || count === 0}
      className="min-h-12 w-full rounded-full bg-brand-turquoise px-5 text-base font-bold text-white disabled:bg-neutral-300"
    >
      {pending ? "كنطبّق…" : count === 0 ? idle : template.replace("{n}", String(count))}
    </button>
  );
}
