/**
 * رسالة عامة وآمنة تُعرض للزائر عند تعذّر الوصول لقاعدة البيانات، بدون أي
 * تفاصيل تقنية. الخطأ الحقيقي يُسجَّل دائماً في سجلات الخادم فقط قبل عرض
 * هذا المكوّن (عبر console.error في الصفحة التي استدعته).
 */
export function ServiceUnavailable() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-lg font-bold text-neutral-800">
        تعذّر تحميل الصفحة مؤقتاً
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        نواجه مشكلة تقنية مؤقتة. الرجاء إعادة تحميل الصفحة بعد قليل، أو
        التواصل معنا مباشرة عبر واتساب.
      </p>
    </div>
  );
}
