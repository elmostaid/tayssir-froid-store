"use client";

import { useEffect } from "react";

/**
 * شبكة أمان أخيرة للوحة الإدارة — لا بديل عن معالجة الأخطاء في مكانها.
 *
 * الأخطاء المعروفة (بحث المنتجات، الحفظ، الاستيراد، انقطاع الإنترنت) تُعالَج
 * الآن داخل صفحاتها برسائل صغيرة بلا أي سقوط. هذا الملف لما لم نتوقّعه: بدله
 * كانت تظهر شاشة Next الافتراضية «This page couldn't load» بلا قائمة ولا
 * شرح. هنا تبقى اللوحة وقائمتها، ورسالة بالعربية، وزرّ «عاود».
 *
 * مسودّة الطلب اليدوي محفوظة في هذا التبويب (manualOrderDraft.ts)، فبعد
 * «عاود» أو إعادة التحميل يقترح النموذج استرجاعها.
 */
export default function AdminSegmentError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("admin: خطأ غير متوقَّع في الصفحة", error);
  }, [error]);

  return (
    <div className="mx-auto mt-8 max-w-md rounded-xl border border-amber-300 bg-amber-50 p-5 text-center">
      <h2 className="text-base font-bold text-amber-900">وقع خطأ مؤقت فهاد الصفحة</h2>
      <p className="mt-2 text-sm leading-relaxed text-amber-900">
        غالباً انقطاع فالإنترنت ولا فالاتصال بالخادم. إلا كنتي كتدخل طلبية يدوية، المعلومات ديالها
        محفوظة فهاد التبويب، ومنين تعاود الصفحة غادي يقترح عليك ترجعها.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="min-h-11 rounded-full bg-brand-orange px-5 text-sm font-semibold text-white"
        >
          عاود
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11 rounded-full border border-neutral-300 px-5 text-sm font-semibold text-neutral-700"
        >
          حمّل الصفحة من جديد
        </button>
      </div>
      {error.digest && <p className="mt-3 text-[10px] text-neutral-400">مرجع: {error.digest}</p>}
    </div>
  );
}
