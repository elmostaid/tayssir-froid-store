"use client";

/**
 * حدود الخطأ لصفحات المتجر. عرضها يعني أن Next.js أرسل رمز خطأ خادم حقيقي
 * (5xx) بدل 200 — وهذا هو المقصود: العطل يجب أن يكون مرئياً لأي فحص توفّر
 * خارجي وغير قابل للفهرسة، لا أن يُقدَّم كصفحة ناجحة (انظر
 * src/lib/serviceUnavailable.ts للسبب الكامل).
 *
 * النص هو نفسه الذي كان في مكوّن ServiceUnavailable — لم يتغيّر ما يراه
 * الزبون إطلاقاً، تغيّر فقط رمز الحالة المُرسَل معه، مع زر إعادة محاولة.
 */
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-lg font-bold text-neutral-800">
        تعذّر تحميل الصفحة مؤقتاً
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        نواجه مشكلة تقنية مؤقتة. الرجاء إعادة تحميل الصفحة بعد قليل، أو
        التواصل معنا مباشرة عبر واتساب.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 min-h-11 rounded-full bg-brand-turquoise px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-turquoise-dark"
      >
        إعادة المحاولة
      </button>
      {error.digest && (
        // معرّف مجهول يربط ما رآه الزبون بسطر الخطأ في سجلات الخادم، بلا أي
        // تفصيل تقني معروض له.
        <p className="mt-4 text-xs text-neutral-400">رمز المرجع: {error.digest}</p>
      )}
    </div>
  );
}
