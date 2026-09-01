import type { OrderAttribution } from "@/lib/attribution/types";
import type { AnalyticsSessionContext } from "@/lib/analytics/events";

export type CartItemInput = {
  productId: number;
  variantId: number | null;
  quantity: number;
};

export type CustomerInput = {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  notes: string | null;
};

// بيانات اختيارية بحتة لتحسين جودة مطابقة Meta Conversions API (CAPI) لحدث
// Purchase (client_ip_address/user_agent/fbp/fbc) — لا علاقة لها بمنطق
// إنشاء الطلب نفسه ولا تُستعمَل فأي تحقق/قرار داخل createOrder. غيابها
// (undefined) آمن تماماً: الحدث يُرسَل بجودة مطابقة أقل فقط.
export type CreateOrderRequestContext = {
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  eventSourceUrl?: string;
  /**
   * كوكي جلسة القياس الداخلي (`tf_sid`) وسياقها (`tf_ctx`) — يقرأهما الخادم
   * ليكتب حدث الشراء بنفسه بدل انتظار المتصفح. غيابهما يعني حدثاً داخلياً
   * غير مكتوب فقط؛ الطلب نفسه لا يتأثّر.
   */
  analyticsSessionId?: string;
  analyticsContext?: AnalyticsSessionContext;
  /** من كوكي `_ga` — يربط شراء GA4 المُرسَل من الخادم بزائر GA4 نفسه. */
  gaClientId?: string;
  /** من كوكي `_ga_<container>` — يربطه بجلسته وحملتها. */
  gaSessionId?: string;
};

export type CreateOrderInput = {
  items: CartItemInput[];
  customer: CustomerInput;
  idempotencyKey: string;
  requestContext?: CreateOrderRequestContext;
  /**
   * مصدر الزبون (أول لمسة وآخر لمسة) كما التقطه المتصفح. اختياري بالكامل:
   * غيابه يعني عموداً NULL في الطلب، ولا يؤثّر على إنشاء الطلب إطلاقاً.
   */
  attribution?: OrderAttribution | null;
};

export type CreateOrderFieldError = {
  /** اسم الحقل، أو "items" لخطأ عام على السلة، أو productId كنص لخطأ خاص بسطر معيّن */
  field: string;
  message: string;
};

export type RejectedLineSummary = {
  name: string;
  sku: string;
  quantity: number;
  reason: string;
};

export type CreateOrderResult =
  | {
      ok: true;
      publicReference: string;
      orderNumber: string;
      /** فيه سطر أو أكثر لم يُحجز مخزونه — طلب مسجَّل لا بيع مكتمل. */
      needsReview: boolean;
      rejectedLines: RejectedLineSummary[];
      /**
       * هل أرسل الخادم شراء GA4 بنفسه (Measurement Protocol).
       *
       * `true` تعني على المتصفح ألّا يُرسله: GA4 لا تُلغي التكرار حسب
       * `transaction_id`، فإرسال الطرفين معاً يُضاعف كل طلب وكل درهم في
       * التقارير. `false` تعني أن الخادم لم يُرسل (لا سرّ مضبوط، أو لا
       * `client_id`) فيبقى المتصفح مسؤولاً كما كان قبل هذا التغيير.
       */
      gaPurchaseHandledServerSide: boolean;
    }
  | { ok: false; errors: CreateOrderFieldError[] };
