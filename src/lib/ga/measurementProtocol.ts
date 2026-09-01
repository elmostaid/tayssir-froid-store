import { GA_MEASUREMENT_ID } from "@/lib/analytics/config";

/**
 * إرسال حدث الشراء إلى GA4 من الخادم عبر Measurement Protocol.
 *
 * لماذا: حدث الشراء في المتصفح لا يُطلَق إلا إذا وصل تأكيد حفظ الطلب قبل
 * أن يغادر الزبون إلى واتساب. الطلب الذي يُحفظ ببطء يفقد الحدث نهائياً. هذا
 * المسار يُرسله من حيث حُفظ الطلب، فلا يعود مرتبطاً ببقاء الصفحة مفتوحة.
 *
 * وعمداً لا نُبقي المسارين معاً: **GA4 لا تُلغي التكرار حسب
 * `transaction_id`** — لو أرسل الخادم والمتصفح كلاهما، لأصبح كل طلب
 * شراءين وإيراداً مضاعفاً. لذلك يُحسم المُرسِل **قبل** أن يبدأ أيّهما:
 * `createOrder` يقرأ `isGaMeasurementProtocolConfigured()` ووجود
 * `client_id`، ويُبلّغ المتصفح بالنتيجة في `gaPurchaseHandledServerSide`.
 * قرارٌ من التهيئة لا من نتيجة الإرسال — وهو ما يسمح بإرسال الحدث بعد
 * الجواب بلا إبطائه، ويُبقي المُرسِل واحداً دائماً.
 *
 * بلا `GA4_API_SECRET` لا يُرسَل شيء من هنا ويعود المتصفح مسؤولاً كما كان —
 * أي أن نشر هذا الكود بلا ضبط السر لا يُغيّر السلوك الحالي ولا يفقد حدثاً.
 */
const MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/** مهلة قصيرة: لا نُبقي دالة serverless معلّقة لأجل القياس. */
const TIMEOUT_MS = 3000;

/** فاصل قصير قبل المحاولة الثانية — انقطاع عابر لا أكثر. */
const RETRY_DELAY_MS = 400;

function getApiSecret(): string | null {
  const raw = process.env.GA4_API_SECRET?.trim();
  return raw ? raw : null;
}

export function isGaMeasurementProtocolConfigured(): boolean {
  return Boolean(GA_MEASUREMENT_ID && getApiSecret());
}

export type GaMpItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  item_variant?: string;
};

export type SendGaPurchaseParams = {
  /** `public_reference` — نفس الرقم الظاهر في لوحة الإدارة وفي GA4. */
  transactionId: string;
  value: number;
  items: GaMpItem[];
  /** من كوكي `_ga`. بدونه لا يمكن ربط الشراء بزائر GA4 إطلاقاً. */
  clientId: string | undefined;
  /** من كوكي `_ga_<container>` — يربط الشراء بجلسة الزائر وحملتها. */
  sessionId: string | undefined;
};

/**
 * يُرجع هل أُرسل الحدث فعلاً. لا يرمي أبداً.
 *
 * القيمة للتسجيل والاختبار: القرار بمن يُرسل اتُّخذ قبل النداء (انظر أعلاه)،
 * فالفشل هنا لا يُعيد المسؤولية إلى المتصفح — يبقى الحدث الداخلي في
 * Supabase هو المرجع الذي تُكشف به الفجوة عند المطابقة.
 */
export async function sendGaPurchaseEvent(
  params: SendGaPurchaseParams
): Promise<boolean> {
  const apiSecret = getApiSecret();
  // بلا client_id لا معنى للإرسال: GA4 سترفض الحدث أو تنسبه إلى مستخدم
  // مخترع، وكلاهما أسوأ من ترك المتصفح يُرسله.
  if (!apiSecret || !GA_MEASUREMENT_ID || !params.clientId) return false;

  const url =
    `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(GA_MEASUREMENT_ID)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`;

  const body = {
    client_id: params.clientId,
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: params.transactionId,
          currency: "MAD",
          value: params.value,
          items: params.items,
          // بدون session_id يُحتسب الشراء جلسة جديدة منفصلة، فينفصل عن
          // الحملة التي جاءت بالزبون. مع engagement_time_msec تعتبره GA4
          // تفاعلاً حقيقياً لا حدثاً بلا جلسة.
          ...(params.sessionId ? { session_id: params.sessionId } : {}),
          engagement_time_msec: 1,
        },
      },
    ],
  };

  // محاولتان: الإرسال يقع بعد الجواب (انظر runAfterResponse) فلا ينتظره
  // أحد، وإعادة المحاولة مرة واحدة تُنقذ الانقطاع العابر بلا أي كلفة على
  // الزبون. أكثر من ذلك بلا فائدة: عطل مستمر يحتاج تشخيصاً لا تكراراً.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // Measurement Protocol يردّ 2xx بلا جسم حتى على حمولة مرفوضة منطقياً؛
      // رمز غير 2xx يعني رفضاً حقيقياً على مستوى النقل.
      if (response.ok) return true;

      console.error(
        `sendGaPurchaseEvent: رفضت GA4 الحدث (HTTP ${response.status}) للطلب ` +
          `${params.transactionId} — المحاولة ${attempt}`
      );
      // 4xx يعني حمولة أو سرّاً خاطئاً؛ إعادة المحاولة لن تُغيّر شيئاً.
      if (response.status < 500) return false;
    } catch (error) {
      console.error(
        `sendGaPurchaseEvent: تعذّر إرسال شراء الطلب ${params.transactionId} ` +
          `إلى GA4 — المحاولة ${attempt}`,
        error
      );
    }

    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  // فشل نهائي: الحدث الداخلي في Supabase موجود على أي حال، وهو مرجع
  // المطابقة الذي يكشف أي نقص في GA4 عند المقارنة.
  console.error(
    `sendGaPurchaseEvent: فشل نهائي لشراء الطلب ${params.transactionId} — ` +
      "الحدث الداخلي في قاعدة البيانات يبقى المرجع"
  );
  return false;
}
