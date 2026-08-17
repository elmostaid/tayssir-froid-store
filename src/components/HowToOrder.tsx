import Link from "next/link";

/**
 * شرح مختصر لطريقة الطلب، موجَّه لزبون يطلب من الموقع أول مرة.
 *
 * مكوّن خادم بحت عن قصد: لا "use client"، ولا حالة، ولا مؤثّرات، ولا صور.
 * كله نص وحدود CSS، فلا يضيف أي JavaScript إلى الحزمة ولا أي طلب شبكة
 * إضافي — لا يمسّ زمن تحميل الصفحة الرئيسية إطلاقاً.
 *
 * زر "ابدأ التسوق" رابط لغة عادي (#categories) لا زر بـJavaScript: قسم
 * التصنيفات في الصفحة نفسها يحمل أصلاً id="categories" وscroll-mt-20، فيهبط
 * إليه المتصفح بسلاسة وبالإزاحة الصحيحة تحت الرأس الثابت، ويعمل حتى لو
 * تعطّل JavaScript كلياً على هاتف قديم.
 *
 * ملاحظة على الأرقام: استُعملت شارات مرقَّمة بألوان العلامة بدل رموز
 * الأرقام التعبيرية (1️⃣2️⃣3️⃣4️⃣) لأن هذه الأخيرة تُعرض مربّعات فارغة على
 * أندرويد قديم — وهي شريحة حقيقية من زبناء هذا المتجر (نفس فئة المشاكل
 * الموثَّقة سابقاً مع الصور). الشارات تظهر متطابقة على كل جهاز.
 */

const STEPS = [
  {
    title: "اختار التصنيف",
    detail: "غسالات، ثلاجات، مكيفات...",
  },
  {
    title: "اختار المنتوج والعدد",
    detail: "وزيد اللي محتاج للسلة.",
  },
  {
    title: "ساليت؟ دخل للسلة",
    detail: "واضغط إتمام الطلب.",
  },
  {
    title: "عمّر معلوماتك ورسل الطلب لواتساب",
    detail: "✅ وصافي، حنا نتكلفو بالباقي.",
  },
];

export function HowToOrder() {
  return (
    <section
      aria-labelledby="how-to-order-title"
      className="mt-6 rounded-2xl border border-brand-turquoise/25 bg-white px-4 py-4 sm:px-5 sm:py-5"
    >
      <h2
        id="how-to-order-title"
        className="text-base font-bold text-neutral-900 sm:text-lg"
      >
        🛒 أول مرة كتطلب من الموقع؟ سهلة بزاف
      </h2>

      <ol className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex items-start gap-3 rounded-xl bg-brand-turquoise-tint/60 px-3 py-2 lg:flex-col lg:gap-2"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-turquoise text-sm font-bold text-white"
            >
              {index + 1}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold leading-snug text-neutral-900">
                {step.title}
              </span>
              <span className="text-xs leading-relaxed text-neutral-600">
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <Link
        href="#categories"
        className="mt-3.5 flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark sm:inline-flex sm:w-auto"
      >
        🛍️ ابدأ التسوق
      </Link>
    </section>
  );
}
