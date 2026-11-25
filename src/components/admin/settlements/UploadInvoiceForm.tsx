"use client";

import { useState } from "react";

/**
 * رفع الفاتورة عبر fetch بدل إرسال HTML عادي: انقطاع الإنترنت أثناء الرفع
 * كان يُظهر صفحة «لا يوجد اتصال» الخاصة بالمتصفح ويُخرج المدير من اللوحة.
 * هنا يبقى في الصفحة مع رسالة. والإعادة آمنة: نفس الملف (نفس البصمة) لا
 * يُسجَّل مرتين، فإن وصل الرفع الأول وضاع جوابه يقول الخادم «سبق رفعها».
 */
export function UploadInvoiceForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    setError(null);
    setPending(true);
    try {
      const response = await fetch(form.action, { method: "POST", body: new FormData(form) });
      // الخادم يجيب بتحويل (303) إلى صفحة التسويات مع النتيجة؛ fetch يتبعه.
      window.location.assign(response.url || "/admin/settlements");
    } catch {
      setError("انقطع الاتصال أثناء الرفع. تأكد من الإنترنت وعاود — نفس الفاتورة ما كتتحسبش جوج مرات.");
      setPending(false);
    }
  }

  return (
    <form
      action="/admin/settlements/upload"
      method="post"
      encType="multipart/form-data"
      onSubmit={onSubmit}
      className="mt-4 rounded-xl border-2 border-brand-orange/30 bg-white p-4"
    >
      <label className="block text-base font-bold text-neutral-800" htmlFor="invoice">
        رفع فاتورة
      </label>
      <input
        id="invoice"
        name="invoice"
        type="file"
        accept="application/pdf,.pdf"
        required
        disabled={pending}
        className="mt-3 block w-full text-sm file:me-3 file:min-h-11 file:rounded-full file:border-0 file:bg-neutral-100 file:px-4 file:font-semibold"
      />
      <button
        type="submit"
        disabled={pending}
        className="mt-3 min-h-12 w-full rounded-full bg-brand-orange px-5 text-base font-bold text-white disabled:bg-neutral-300"
      >
        {pending ? "كنقرا الفاتورة…" : "ارفع واقرا"}
      </button>
      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
