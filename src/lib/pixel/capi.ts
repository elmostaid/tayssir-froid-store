import { createHash } from "node:crypto";
import { getMetaPixelId } from "@/lib/pixel/config";

// Meta Conversions API — يُكمِّل Pixel (المتصفح) بإرسال نفس الأحداث من
// الخادم مباشرة. عمداً بلا "import 'server-only'" هنا (خلافاً لـ
// purchasePrices.ts): createOrder.ts يستورد هذا الملف، وcreateOrder.ts
// نفسه تستورده عشرات الاختبارات مباشرة (بيئة jsdom عادية) — server-only
// يرمي دائماً خارج بيئة بناء Next.js الحقيقية (لا تُفعَّل شرط "react-server"
// تحت Vitest)، فكان سيُسقِط كل تلك الاختبارات القائمة. الحماية الفعلية هنا
// أصلاً بلا حاجة لذلك: META_CONVERSIONS_API_ACCESS_TOKEN بلا بادئة
// NEXT_PUBLIC_، فـNext.js لا يُضمِّن قيمته أبداً فحزمة المتصفح بأي حال —
// فقط لا تستورد هذا الملف من أي مكوّن "use client".
const GRAPH_API_VERSION = "v21.0";

function getAccessToken(): string | null {
  const raw = process.env.META_CONVERSIONS_API_ACCESS_TOKEN?.trim();
  if (!raw) return null;
  return raw;
}

/**
 * مؤقت — لاختبار CAPI عبر Meta Events Manager → Test Events فقط (انظر
 * .env.example). بلا META_TEST_EVENT_CODE، لا شيء يتغيّر فالسلوك الحالي —
 * test_event_code لا يُدرَج فالطلب إطلاقاً (نفس ما كان قبل هذه الدالة حرفياً).
 */
function getTestEventCode(): string | null {
  const raw = process.env.META_TEST_EVENT_CODE?.trim();
  if (!raw) return null;
  return raw;
}

export function isCapiConfigured(): boolean {
  return Boolean(getMetaPixelId() && getAccessToken());
}

/** SHA256 hex، بعد trim + lowercase — نفس تنسيق Meta الإلزامي لأي user_data مُجزَّأ (em/ph). */
export function hashForCapi(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export type CapiUserData = {
  /** أرقام دولية خالصة بلا "+" (مثلاً 212612345678) — تُجزَّأ هنا تلقائياً، لا تُمرِّر رقماً مُجزَّأ مسبقاً. */
  phone?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  /** كوكي _fbp من متصفح الزبون، إن توفّرت. */
  fbp?: string;
  /** كوكي _fbc من متصفح الزبون، أو مبنيّة من fbclid (lib/pixel/fbc.ts). */
  fbc?: string;
  /**
   * مُعرّف ثابت للزبون عند المتجر — يُجزَّأ هنا، لا يُمرَّر مُجزَّأً.
   *
   * يرفع جودة المطابقة حين لا توجد fbp/fbc (طلب مباشر، متصفح حاجب). الهاتف
   * المطبَّع يصلح له: ثابت عبر الجلسات والأجهزة، وموجود في كل طلب.
   */
  externalId?: string;
};

// الشكل الشائع لأحداث المنتج (Purchase/AddToCart/ViewContent/InitiateCheckout)
// — نوع مرجعي وليس النوع الفعلي لبارامتر customData (PageView مثلاً لا
// يحتاج أياً من هذه الحقول، فـsendCapiEvent تقبل Record عاماً أكثر مرونة).
export type CapiCustomData = {
  content_ids: string[];
  content_type: "product";
  currency: "MAD";
  value?: number;
  contents?: { id: string; quantity: number; item_price: number }[];
  num_items?: number;
  content_name?: string;
  content_category?: string;
};

export type SendCapiEventParams = {
  eventName: string;
  /**
   * لحظة وقوع الحدث فعلاً (ms منذ epoch). افتراضها "الآن" صحيح للأحداث
   * الفورية؛ أما الشراء المؤجَّل فيقع لحظة التأكيد التجاري لا لحظة
   * الإرسال، فيمرّر `confirmed_at` صريحاً.
   *
   * Meta ترفض حدثاً أقدم من سبعة أيام. القياس في الإنتاج: التأكيد يقع
   * بوسيط صفر ساعة وبحدٍّ أقصى 15.3 ساعة من الإرسال، فالحدّ ليس قريباً.
   */
  eventTimeMs?: number;
  /** نفس event_id المُستعمَل فحدث Pixel المطابق (من جهة المتصفح) — إلزامي لعمل deduplication بشكل صحيح. */
  eventId: string;
  eventSourceUrl?: string;
  userData?: CapiUserData;
  customData: Record<string, unknown>;
};

/**
 * يرسل حدثاً واحداً إلى Meta Conversions API. لا يرمي أبداً أي استثناء —
 * فشل الإرسال (توكن غير مضبوط، شبكة، خطأ من Meta) يُسجَّل فقط فـ console
 * ولا يُؤثِّر أبداً على الصفحة/الطلب الذي استدعاه (نفس نمط notifyNewOrder
 * الموجود أصلاً فـcreateOrder.ts — "أفضل مجهود" لا يكسر أي مسار حقيقي).
 */
/**
 * نتيجة الإرسال — `ok` تعني أن **Meta أكّدت الاستلام**، لا أننا نادينا.
 *
 * الفرق ليس لفظياً: الشراء المؤجَّل يستهلك حرس exactly-once قبل النداء،
 * فلو اعتبرنا مجرّد النداء نجاحاً لضاعت البيعة صامتةً عند أي انقطاع. ومن
 * هنا `eventsReceived`: Meta تردّ 200 مع `events_received`، والصفر فيه
 * يعني أنها لم تستلم شيئاً رغم الرمز 200.
 */
export type CapiSendResult = {
  ok: boolean;
  /** عدد الأحداث التي أقرّت Meta باستلامها. */
  eventsReceived?: number;
  /** رمز HTTP إن وصل جواب أصلاً. */
  status?: number;
  /** وصف الفشل، جاهزاً للحفظ في `orders.meta_purchase_error`. */
  error?: string;
  /** هل يستحقّ الفشل محاولة لاحقة (شبكة/5xx) أم لا (4xx، تهيئة ناقصة). */
  retryable?: boolean;
};

/** مهلة قصيرة: لا نُبقي دالة serverless معلّقة لأجل القياس. */
const CAPI_TIMEOUT_MS = 4000;

/** فاصل قصير قبل المحاولة الثانية داخل النداء — انقطاع عابر لا أكثر. */
const CAPI_RETRY_DELAY_MS = 400;

/** محاولتان داخل النداء؛ ما بعدهما يحتاج تشخيصاً لا تكراراً. */
const CAPI_ATTEMPTS = 2;

export async function sendCapiEvent(params: SendCapiEventParams): Promise<CapiSendResult> {
  const pixelId = getMetaPixelId();
  const accessToken = getAccessToken();
  // تهيئة ناقصة ليست انقطاعاً عابراً: إعادة المحاولة لن تُنشئ توكناً.
  if (!pixelId || !accessToken) {
    return { ok: false, error: "CAPI غير مُهيَّأ — pixel id أو access token ناقص", retryable: false };
  }

  {
    const userData: Record<string, unknown> = {};
    if (params.userData?.phone) userData.ph = [hashForCapi(params.userData.phone)];
    if (params.userData?.clientIpAddress) userData.client_ip_address = params.userData.clientIpAddress;
    if (params.userData?.clientUserAgent) userData.client_user_agent = params.userData.clientUserAgent;
    if (params.userData?.fbp) userData.fbp = params.userData.fbp;
    if (params.userData?.fbc) userData.fbc = params.userData.fbc;
    if (params.userData?.externalId) {
      userData.external_id = [hashForCapi(params.userData.externalId)];
    }

    const testEventCode = getTestEventCode();

    const body = {
      data: [
        {
          event_name: params.eventName,
          event_time: Math.floor(
            (typeof params.eventTimeMs === "number" && Number.isFinite(params.eventTimeMs)
              ? params.eventTimeMs
              : Date.now()) / 1000
          ),
          event_id: params.eventId,
          action_source: "website",
          event_source_url: params.eventSourceUrl,
          user_data: userData,
          custom_data: params.customData,
        },
      ],
      // فقط عند ضبط META_TEST_EVENT_CODE — غيابه يترك الجسم كما كان بالضبط
      // (بلا هذا الحقل إطلاقاً)، فلا تغيير على event_id ولا deduplication
      // ولا أي حقل آخر.
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    };

    const url =
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events` +
      `?access_token=${encodeURIComponent(accessToken)}`;

    let last: CapiSendResult = { ok: false, error: "لم تُجرَ أي محاولة", retryable: true };

    for (let attempt = 1; attempt <= CAPI_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(CAPI_TIMEOUT_MS),
        });

        const text = await response.text().catch(() => "");

        if (response.ok) {
          // 200 وحده لا يكفي: Meta تردّ 200 مع `events_received: 0` حين
          // تُسقِط الحدث. فالقبول هو أن تُقرّ باستلام حدث واحد على الأقل.
          let received: number | undefined;
          try {
            const parsed = JSON.parse(text) as { events_received?: unknown };
            if (typeof parsed.events_received === "number") received = parsed.events_received;
          } catch {
            // جسمٌ غير JSON مع 200: نعتبره قبولاً بلا عدد — لا نُسقِط بيعة
            // لأن شكل الجواب تغيّر.
          }

          if (received === undefined || received >= 1) {
            return { ok: true, status: response.status, eventsReceived: received };
          }

          console.error(
            `sendCapiEvent: قبلت Meta الطلب ولم تستلم أي حدث "${params.eventName}" (events_received=0)`,
            text
          );
          // `events_received: 0` عطبٌ في الحمولة لا في الشبكة.
          return { ok: false, status: response.status, eventsReceived: 0, error: `events_received=0 — ${text.slice(0, 300)}`, retryable: false };
        }

        console.error(
          `sendCapiEvent: رفضت Meta الحدث "${params.eventName}" (HTTP ${response.status}) — المحاولة ${attempt}`,
          text
        );
        // 4xx حمولة أو توكن خاطئ؛ إعادة المحاولة لن تُغيّر شيئاً. و429/5xx
        // ضغطٌ أو عطلٌ عابر يستحقّ محاولة ثانية.
        const retryable = response.status >= 500 || response.status === 429;
        last = { ok: false, status: response.status, error: `HTTP ${response.status} — ${text.slice(0, 300)}`, retryable };
        if (!retryable) return last;
      } catch (error) {
        console.error(
          `sendCapiEvent: تعذّر إرسال الحدث "${params.eventName}" إلى Meta CAPI — المحاولة ${attempt}`,
          error
        );
        last = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          retryable: true,
        };
      }

      if (attempt < CAPI_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, CAPI_RETRY_DELAY_MS));
      }
    }

    return last;
  }
}
