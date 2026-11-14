"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * إعادة محاولة تحميل القسم المتعذّر.
 *
 * `router.refresh()` يُعيد طلب مكوّنات الخادم لنفس المسار بنفس الوسائط،
 * فيُعاد تنفيذ الاستعلام الذي فشل وحده دون أن يفقد المستخدم موضعه في
 * الصفحة ولا فلاتره. وهذا هو المطلوب هنا بالضبط: سبب الفشل الأول — تعذّر
 * الوصول إلى مجمّع الاتصالات — عابر في أغلب الحالات، فمحاولة ثانية بعد
 * ثوانٍ تنجح عادةً بلا تدخّل.
 */
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setTried(true);
        startTransition(() => router.refresh());
      }}
      className="mt-2 inline-flex min-h-9 items-center rounded-full border border-amber-400 bg-white px-3 text-xs font-semibold text-amber-900 disabled:opacity-60"
    >
      {pending ? "جارٍ إعادة المحاولة…" : tried ? "حاول مرة أخرى" : "إعادة المحاولة"}
    </button>
  );
}
