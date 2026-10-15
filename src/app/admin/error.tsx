"use client";

import Link from "next/link";

/**
 * حدود الخطأ للوحة الإدارة.
 *
 * قبل هذا الملف لم يكن تحت `/admin` أي `error.tsx` إطلاقاً (الموجود الوحيد
 * كان `(storefront)/error.tsx`). فأي استثناء يُرمى أثناء **تصيير** قسم
 * واحد — لا أثناء جلب بياناته، ذاك تلتقطه `loadSection` — كان يصعد بلا
 * حاجز إلى جذر التطبيق، فتختفي اللوحة كلها خلف شاشة خطأ Next.js العامة.
 * صاحب المتجر يفقد الطلبات والمخزون والتقارير بسبب عطل في قسم واحد.
 *
 * موضعه `/admin` لا `/admin/(protected)`: `error.tsx` **لا يلفّ تخطيط
 * segment نفسه**، بل التخطيطات المتداخلة تحته. فوضعه هنا يجعله يلتقط
 * أخطاء `(protected)/layout.tsx` أيضاً — وهو تخطيط يستدعي `getAdminUser()`
 * ويمسّ الشبكة، فهو بالضبط ما يحتاج الحماية.
 *
 * **ما يلتقطه فعلاً**: استثناءات التصيير في Server وClient Components تحت
 * `/admin`.
 *
 * **وما لا يلتقطه — ولا يُدّعى أنه يلتقطه**:
 *   • انتهاء مهلة دالّة Vercel (الدالّة تُقتَل قبل أن تصل أي استجابة؛
 *     المتصفّح يرى اتصالاً مقطوعاً لا صفحة React).
 *   • أخطاء الاتصال التي تلتقطها `loadSection` أصلاً فتعيد `{ ok: false }`
 *     بدل أن ترمي — تلك يعرضها القسم المعني وحده، وهو السلوك المقصود.
 *   • أخطاء خارج شجرة React (معالِجات أحداث، `setTimeout`).
 *   • أخطاء `admin/layout.tsx` نفسه لو أُضيف لاحقاً (ذاك شأن `global-error`).
 *
 * فهذا الملف يحوّل «انهيار اللوحة» إلى «قسم معطوب داخل لوحة سليمة»، ولا
 * يصلح أياً من أسباب العطل نفسها.
 */
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  /**
   * Next.js 16: إعادة المحاولة الصحيحة هي `unstable_retry()` لا `reset()`.
   * الفرق جوهري هنا: `reset()` يمسح حالة الخطأ ويُعيد التصيير **بلا إعادة
   * جلب**، فخطأ سببه تعذُّر الوصول لقاعدة البيانات كان سيعود فوراً بنفس
   * البيانات الفاشلة. `unstable_retry()` يُعيد الجلب والتصيير معاً — وهو
   * وحده ما ينفع لعطل عابر في الاتصال.
   */
  unstable_retry: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h1 className="text-base font-bold text-red-800">تعذّر عرض هذا القسم</h1>

        <p className="mt-2 text-sm leading-relaxed text-red-900">
          وقع خطأ أثناء تحضير هذه الصفحة. بقية لوحة الإدارة تعمل كالمعتاد —
          الطلبات والمخزون والتقارير لم يصبها شيء.
        </p>

        <p className="mt-1 text-sm leading-relaxed text-neutral-700">
          <span className="font-semibold">لم يُحفظ ولم يُعدَّل أي شيء</span> بسبب هذا
          الخطأ: هذه الصفحة تعرض فقط.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="min-h-11 rounded-lg bg-brand-turquoise px-4 text-sm font-bold text-white"
          >
            إعادة المحاولة
          </button>
          <Link
            href="/admin"
            className="flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-700"
          >
            رجوع للوحة
          </Link>
        </div>

        {/* في الإنتاج لا تصل رسالة خطأ Server Component إلى المتصفّح (منعاً
            لتسريب تفاصيل حسّاسة) — يصل `digest` وحده. وهو ما يربط ما رآه
            المستخدم بالسطر المقابل في سجلّات الخادم، فعرضه ليس زينة. */}
        {error.digest && (
          <p className="mt-4 border-t border-red-200 pt-3 text-[11px] text-neutral-600">
            رمز الخطأ للدعم:{" "}
            <code dir="ltr" className="font-mono font-semibold">
              {error.digest}
            </code>
          </p>
        )}
      </div>
    </div>
  );
}
