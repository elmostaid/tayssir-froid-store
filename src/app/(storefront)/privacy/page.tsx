import type { Metadata } from "next";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { AD_CONSENT_MAX_AGE_DAYS } from "@/lib/privacy/consent";

export const metadata: Metadata = {
  title: "سياسة الخصوصية",
  description: "كيف تستعمل Tayssir Froid بياناتك الشخصية، ومع من تشاركها، وكيف تمارس حقوقك.",
};

/**
 * سياسة الخصوصية — ما تشترطه المادة 5 من القانون 09-08 والفقرة 6 من
 * مداولة CNDP D-939-2025: هوية المسؤول، الغايات، فئات البيانات،
 * المُتلقّون بما فيه النقل للخارج، طريقة ممارسة الحقوق، ومراجع وصولات CNDP.
 *
 * ⚠ النصّ مسودّة تقنية دقيقة لما يفعله الكود فعلاً، لا رأي قانوني. يحتاج
 * مراجعة مستشار قبل النشر.
 *
 * ## قاعدة: لا معلومة قانونية غير مؤكَّدة على صفحة عامة
 *
 * لا رقم وصل CNDP ولا إذن نقل ولا اسم شركة يُعرض ما لم يوجد فعلاً:
 * - قسم «مراجع CNDP» لا يُرسم أصلاً حتى يُضبط `CNDP_RECEIPT_NUMBERS`.
 * - النشاط يسيّره شخص ذاتي بلا شركة مسجَّلة: لا اسم تجاري قانوني ولا رقم
 *   سجلّ يُخترع. البريد يظهر فقط إن ضُبط `PRIVACY_CONTACT_EMAIL`.
 * - النقل للخارج يُذكر كحقيقة (أين تُعالَج البيانات)، لا كإذن مُنح.
 */
export default async function PrivacyPage() {
  const settings = await safeQuery(() => getSettings(), FALLBACK_SETTINGS, "PrivacyPage.getSettings");
  const receipts = process.env.CNDP_RECEIPT_NUMBERS?.trim() || null;
  const contactEmail = process.env.PRIVACY_CONTACT_EMAIL?.trim() || null;

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 text-sm leading-7 text-neutral-700">
      <h1 className="text-xl font-bold text-neutral-900">سياسة الخصوصية</h1>

      <h2 className="mt-6 font-bold text-neutral-900">المسؤول عن المعالجة</h2>
      <p>
        {settings.storeName}، نشاط تجاري يسيّره شخص ذاتي — {settings.storeCity}. للتواصل بخصوص
        بياناتك: واتساب <span dir="ltr">{settings.whatsappNumber}</span>
        {contactEmail && (
          <>
            {" "}
            أو البريد <span dir="ltr">{contactEmail}</span>
          </>
        )}
        .
      </p>

      <h2 className="mt-6 font-bold text-neutral-900">ما نجمعه ولماذا</h2>
      <ul className="list-inside list-disc">
        <li>
          <strong>عند الطلب:</strong> الاسم، الهاتف، المدينة، العنوان، والمنتجات — لتنفيذ الطلبية
          وتوصيلها والتواصل معك بشأنها.
        </li>
        <li>
          <strong>إحصاء الزيارات:</strong> الصفحات المزارة ومصدر الزيارة (مثل اسم الحملة) — لقياس
          أداء الموقع، بلا ملف شخصي عنك.
        </li>
        <li>
          <strong>قياس الإعلانات عند تأكيد الطلبية:</strong> نُبلّغ Meta (فيسبوك وإنستغرام) من خادمنا
          بأن البيعة تمّت: قيمتها، منتجاتها، رقم هاتفك <strong>مُشفَّراً</strong> (SHA-256)، والبلد —
          لا غير. بلا كوكيز ولا تتبّع لتصفّحك. الأساس: مصلحتنا المشروعة في قياس نتائج إعلاناتنا.
          ولك أن تعترض في أي وقت برسالة واتساب، فلا نُرسل بيانات طلبياتك.
        </li>
        <li>
          <strong>كوكيز Meta (غير مفعّلة حالياً، ولا تُفعَّل إلا بموافقتك):</strong> معرّفات Meta Pixel (<span dir="ltr">_fbp</span>،{" "}
          <span dir="ltr">_fbc</span>)، ومعرّف النقر على الإعلان، وعنوان IP ونوع المتصفح — لقياس
          نتائج إعلاناتنا على فيسبوك وإنستغرام. وعند تأكيد طلبيتك نُرسل إلى Meta قيمتها
          ومنتجاتها، ورقم هاتفك <strong>مُشفَّراً</strong> (SHA-256) لا كما هو.
        </li>
      </ul>

      <h2 className="mt-6 font-bold text-neutral-900">المُتلقّون والنقل إلى الخارج</h2>
      <ul className="list-inside list-disc">
        <li>شركات التوصيل: الاسم والهاتف والعنوان، لتسليم الطلبية.</li>
        <li>Meta (فيسبوك وإنستغرام): بيانات البيعة المؤكَّدة كما وُصفت أعلاه.</li>
        <li>
          Google (Google Analytics): إحصاء الزيارات وحده — إشارات Google وتخصيص الإعلانات مُعطَّلان.
        </li>
        <li>مزوّدو الاستضافة: Vercel (الموقع) وSupabase (قاعدة البيانات).</li>
      </ul>
      <p className="mt-2">بعض هؤلاء المزوّدين يعالجون البيانات خارج المغرب.</p>

      <h2 className="mt-6 font-bold text-neutral-900">مدة الاحتفاظ</h2>
      <ul className="list-inside list-disc">
        <li>
          معرّفات Meta وعنوان IP ونوع المتصفح ومعرّفات النقر: {AD_CONSENT_MAX_AGE_DAYS} يوماً ثم تُمحى
          تلقائياً.
        </li>
        <li>كوكي Google Analytics (<span dir="ltr">_ga</span>): {AD_CONSENT_MAX_AGE_DAYS} يوماً.</li>
        <li>بيانات الطلبية: المدة التي يفرضها القانون لحفظ الوثائق التجارية والمحاسبية.</li>
      </ul>

      <h2 className="mt-6 font-bold text-neutral-900">حقوقك</h2>
      <p>
        لك حق الولوج إلى بياناتك وتصحيحها والاعتراض على معالجتها (المواد 7 و8 و9 من القانون 09-08).
        راسلنا على واتساب أعلاه.
      </p>

      {receipts && (
        <>
          <h2 className="mt-6 font-bold text-neutral-900">مراجع CNDP</h2>
          <p dir="ltr">{receipts}</p>
        </>
      )}
    </article>
  );
}
