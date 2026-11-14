import type { Sql } from "postgres";
import type { AnalyticsSessionContext } from "@/lib/analytics/events";

/**
 * كتابة حدث **إرسال الطلب** الداخلي من الخادم، فور نجاح حفظ الطلب.
 *
 * كان اسم الحدث `purchase`، وهو ما كان يُقال عن طلبٍ لم يُؤكَّد بعد. طلب
 * الموقع ليس بيعة: الزبون يؤكّد في واتساب لاحقاً، وما لا يُؤكَّد يُلغى.
 * فصار الحدث `order_submitted` — والبيعة تُقرأ من `orders.confirmed_at`،
 * وهو العمود الذي يُرسَل عنده `Purchase` إلى Meta كذلك.
 *
 * ولا راية `needs_review` منفصلة هنا عمداً: الصفّ يحمل `order_id`، وحالة
 * الطلب تُقرأ من `orders.status` بضمّةٍ واحدة. عمودٌ جديد يُكرّر حقيقةً
 * موجودة ويُخاطر بانحرافها.
 *
 * لماذا هنا وليس في المتصفح كما كان: المتصفح كان يُطلق الشراء فقط إذا وصله
 * تأكيد الحفظ خلال 2.5 ثانية، ثم ينتقل فوراً إلى واتساب. أي طلب يُحفظ
 * بنجاح لكن أبطأ من ذلك كان يُنشئ طلباً حقيقياً بلا أي حدث شراء — وهذا ما
 * وقع فعلاً لطلب TF-2026-0081. الطلب المحفوظ هو مصدر الحقيقة، فالحدث يجب
 * أن يُكتب من الخادم الذي حفظه، لا من صفحة قد تكون غادرت.
 *
 * ولماذا **بعد** المعاملة لا داخلها: صفّ قياس داخل معاملة الطلب يعني أن
 * خطأ في القياس يُلغي طلباً حقيقياً. هذا مرفوض هنا كما هو مرفوض في كل مسار
 * قياس آخر في المشروع. الطلب يُثبَّت أولاً، ثم يُكتب الحدث بمعزل عنه.
 *
 * وexactly-once لا يعتمد على ذلك أصلاً: `createOrder` لا يستدعي هذه الدالة
 * إلا حين `result.isNew`، أي المعاملة التي أدخلت الطلب فعلاً — وإدخال
 * الطلب محروس بـ`on conflict (idempotency_key) do nothing`، فإعادة الإرسال
 * بنفس المفتاح لا تصل إلى هنا. والفهرس الفريد الجزئي
 * (`analytics_events_one_submit_per_order_idx`) هو الضمانة الأخيرة في
 * القاعدة نفسها.
 */
export type ServerOrderSubmittedInput = {
  orderId: number;
  orderValue: number;
  quantity: number;
  sessionId: string | undefined;
  context: AnalyticsSessionContext | undefined;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** أطول نص نسمح بدخوله أعمدة السياق — نفس حدّ مسار /api/analytics. */
const MAX_TEXT = 512;

function text(value: string | null | undefined, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * يكتب صف الشراء ويُرجع هل كُتب. لا يرمي أبداً — فشل القياس يُسجَّل في لوق
 * الخادم فقط ولا يمسّ الطلب المحفوظ.
 *
 * يتطلّب `session_id` صالحاً لأن العمود `uuid not null`: بلا كوكي جلسة
 * (زائر منع الكوكيّات مثلاً) لا نخترع مُعرّفاً — نتخطّى الصف ونُبلّغ.
 */
export async function writeServerOrderSubmittedEvent(
  db: Sql,
  input: ServerOrderSubmittedInput
): Promise<boolean> {
  const sessionId = input.sessionId?.trim();
  if (!sessionId || !UUID_RE.test(sessionId)) return false;

  const ctx = input.context;

  try {
    await db`
      insert into public.analytics_events (
        session_id, event_name, page_path, landing_path, referrer_host,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        has_click_id, order_id, order_value, cart_value, quantity
      ) values (
        ${sessionId}, 'order_submitted', '/checkout', ${text(ctx?.landingPath)},
        ${text(ctx?.referrerHost, 255)},
        ${text(ctx?.utmSource, 128)}, ${text(ctx?.utmMedium, 128)},
        ${text(ctx?.utmCampaign, 191)}, ${text(ctx?.utmContent, 191)},
        ${text(ctx?.utmTerm, 191)},
        ${Boolean(ctx?.hasClickId)}, ${input.orderId}, ${input.orderValue},
        ${input.orderValue}, ${input.quantity}
      )
      on conflict do nothing
    `;
    return true;
  } catch (error) {
    console.error("writeServerOrderSubmittedEvent: تعذّر تسجيل حدث إرسال الطلب الداخلي", error);
    return false;
  }
}
