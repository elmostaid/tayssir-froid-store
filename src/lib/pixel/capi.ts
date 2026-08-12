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
  /** كوكي _fbc من متصفح الزبون، إن توفّرت. */
  fbc?: string;
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
export async function sendCapiEvent(params: SendCapiEventParams): Promise<void> {
  const pixelId = getMetaPixelId();
  const accessToken = getAccessToken();
  if (!pixelId || !accessToken) return;

  try {
    const userData: Record<string, unknown> = {};
    if (params.userData?.phone) userData.ph = [hashForCapi(params.userData.phone)];
    if (params.userData?.clientIpAddress) userData.client_ip_address = params.userData.clientIpAddress;
    if (params.userData?.clientUserAgent) userData.client_user_agent = params.userData.clientUserAgent;
    if (params.userData?.fbp) userData.fbp = params.userData.fbp;
    if (params.userData?.fbc) userData.fbc = params.userData.fbc;

    const testEventCode = getTestEventCode();

    const body = {
      data: [
        {
          event_name: params.eventName,
          event_time: Math.floor(Date.now() / 1000),
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

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `sendCapiEvent: رفضت Meta الحدث "${params.eventName}" (HTTP ${response.status})`,
        text
      );
    }
  } catch (error) {
    console.error(`sendCapiEvent: تعذّر إرسال الحدث "${params.eventName}" إلى Meta CAPI`, error);
  }
}
