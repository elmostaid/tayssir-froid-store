import { sql } from "@/lib/db";
import { sendCapiEvent } from "@/lib/pixel/capi";
import { resolveFbc } from "@/lib/pixel/fbc";
import { toInternationalDigits } from "@/lib/phone";
import { SALE_CONFIRMED_STATUSES, type OrderStatus } from "@/lib/orders/orderStatus";
import {
  isGaMeasurementProtocolConfigured,
  sendGaPurchaseEvent,
} from "@/lib/ga/measurementProtocol";

// عمداً بلا `import "server-only"` — نفس قرار lib/pixel/capi.ts وللسبب
// نفسه: actions.ts تستورد هذا الملف، وعشرات الاختبارات تستورد actions.ts في
// بيئة jsdom، و`server-only` يرمي هناك دائماً (شرط "react-server" لا يُفعَّل
// تحت Vitest) فيُسقِط اختبارات قائمة لا علاقة لها بالقياس. والحماية الفعلية
// قائمة أصلاً: التوكن بلا بادئة NEXT_PUBLIC_ فلا يُضمَّن في حزمة المتصفح
// أبداً — فقط لا تستورد هذا الملف من أي مكوّن "use client".

/**
 * البيعة المؤكَّدة إلى Meta وGA4 — في لحظة التأكيد التجاري، لا الإرسال.
 *
 * ## لماذا مؤجَّل
 *
 * طلب الموقع ليس بيعة بعد: الزبون يؤكّد في واتساب لاحقاً، وما لا يُؤكَّد
 * يُلغى. وكان الشراء يُرسَل عند الإرسال، فتعرف Meta ببيعةٍ ولا تعرف أنها
 * لم تكتمل. القياس المقارن أظهر 38 إلغاءً/حذفاً بقيمة 45,985 درهم لم تصل
 * منها Meta خبراً واحداً، وتضخيماً في القيمة بين 2.4× و6.0× حسب الحملة.
 *
 * ## القرارات التي يقوم عليها هذا الملف
 *
 * **1. `event_time` = لحظة التأكيد، لا لحظة الإرسال.** لا نُرجع الحدث إلى
 * الخلف لندخله عنوةً في نافذة الإسناد؛ الشراء وقع حين أكّد الزبون. والقياس
 * يقول إن ذلك آمن: التأكيد في الإنتاج يقع بوسيط صفر ساعة، و90% منه خلال
 * 11.5 ساعة، وأقصاه 40.9 ساعة — ولا طلب واحد تأكّد بعد سبعة أيام (حدّ Meta).
 *
 * **2. الهوية من اللقطة، لا من الطلب الحالي.** الاستدعاء يأتي من فعل
 * المدير، فـIP والـUser-Agent وكوكي `_fbp` في ذلك الطلب كلها للمدير. لو
 * قُرئت لأرسلنا هوية المدير بوصفها هوية الزبون، فتبدو كل التحويلات من شخص
 * واحد — وهو أسوأ من ألّا نُرسل شيئاً. المصدر الوحيد هو `capi_identity`
 * و`ga_identity` المحفوظتان وقت الإرسال.
 *
 * **3. الشراء ليس على `confirmed` حرفياً.** 13 طلباً في الإنتاج (13% من
 * المشحونة) وصل `shipped` دون أن يمرّ بـ`confirmed` قطّ. فأي حالة من
 * `SALE_CONFIRMED_STATUSES` اعترافٌ بأن البيعة تمّت.
 *
 * **4. مبيعات الموقع وحدها.** الطلب اليدوي (واتساب/هاتف/محل) لا يُرسل
 * شيئاً: أول بيعة مرّت على هذا المسار كانت طلباً يدوياً (177) فأرسلت
 * Purchase بلا `fbp` ولا `fbc` ولا IP ولا User-Agent — أي بيعةٌ لا تُنسَب
 * لإعلان ولا تُعلّم Meta شيئاً، لكنها تُضخّم عدّاد التحويلات وتُفسد كل ROAS
 * نحسبه بعدها. والطلب الذي **بدأ في الموقع وأُغلق في واتساب** يبقى داخل
 * المبيعات: `source` يُكتب 'website' لحظة إنشائه في الموقع، ولا يتغيّر بعدها
 * أبداً مهما تمّ الإغلاق على واتساب.
 *
 * **5. الحجز قبل الإرسال، والتحرير عند الفشل.** العمود يُطالَب به ذرّياً
 * (`where ... is null`) قبل أي نداء، فاستدعاءان متوازيان لا يُرسلان مرتين.
 * وكان ذلك يعني أن فشل الشبكة يُهلك البيعة صامتةً، فصار الفشل يُحرّر الحجز
 * ويُسجّل سببه — وإعادة المحاولة آمنة لأن `event_id` حتمي، فأي تكرار
 * تُسقطه Meta نفسها. وسقف المحاولات يمنع المطاردة اللانهائية لعطب مستمر.
 *
 * **6. النجاح = إقرار المنصّة، لا نداؤنا.** `sendCapiEvent` ترجع الآن
 * نتيجةً تقرأ `events_received`، و`meta_purchase_accepted_at` لا يُكتب إلا
 * عند إقرار Meta فعلاً. فسطر "أُرسل" بلا "قُبل" سؤالٌ مفتوح لا نجاحٌ مفترض.
 */

/** سقف المحاولات لكل منصّة. بعده يبقى `*_error` شاهداً ويتوقّف التكرار. */
export const MAX_PURCHASE_ATTEMPTS = 5;

/** الشكل المحفوظ في `orders.capi_identity` وقت إرسال الطلب. */
export type CapiIdentitySnapshot = {
  fbp?: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  /** لحظة أول ظهور الـfbclid (ms) — لبناء fbc إن غابت الكوكي. */
  fbclidAt?: number | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  eventSourceUrl?: string | null;
};

/** الشكل المحفوظ في `orders.ga_identity` وقت إرسال الطلب. */
export type GaIdentitySnapshot = {
  /** من كوكي `_ga` — بدونه لا يُرسَل شيء إلى GA4 إطلاقاً. */
  clientId?: string | null;
  /** من كوكي `_ga_<container>` — يربط البيعة بجلسة الزائر وحملتها. */
  sessionId?: string | null;
};

export type DeferredPurchaseSkipReason =
  | "already_sent"
  | "not_a_sale"
  | "not_website"
  | "order_not_found"
  | "nothing_to_send"
  | "attempts_exhausted"
  | "delivery_failed";

export type DeferredPurchaseOutcome =
  | { sent: true; orderId: number; eventId: string; gaSent: boolean }
  | { sent: false; reason: DeferredPurchaseSkipReason; error?: string };

/**
 * `event_id` حتمي وخاصّ بالشراء.
 *
 * عمداً ليس `idempotencyKey` (الذي يحمله `OrderSubmitted`): معرّفٌ واحد
 * لحدثين مختلفين يعني أن Meta قد تعتبر أحدهما تكراراً للآخر فتُسقطه.
 * وحتمي حتى تُسقِط Meta أي إرسال ثانٍ لنفس البيعة — وهو ما يجعل إعادة
 * المحاولة بعد فشل الشبكة آمنةً بلا احتمال احتساب مزدوج.
 */
export function purchaseEventId(orderId: number): string {
  return `purchase:${orderId}`;
}

type OrderRow = {
  id: number;
  status: OrderStatus;
  source: string;
  items_subtotal: string;
  public_reference: string;
  customer_phone: string | null;
  confirmed_at: Date | null;
  capi_identity: CapiIdentitySnapshot | null;
  ga_identity: GaIdentitySnapshot | null;
  attribution_last: { fbclid?: string | null; at?: number | null } | null;
  attribution_first: { fbclid?: string | null; at?: number | null } | null;
};

type ReservedLine = {
  product_name_snapshot: string | null;
  sku_snapshot: string | null;
  quantity: number;
  unit_price_snapshot: string | null;
};

type MetaDelivery =
  | { kind: "sent"; eventId: string }
  | { kind: "skipped"; reason: DeferredPurchaseSkipReason; error?: string };

/**
 * يُرسَل مرة واحدة لكل طلب، لكل منصّة. آمن للاستدعاء على أي تغيير حالة:
 * يخرج صامتاً إن لم تكن البيعة قد تمّت، أو إن أُرسلت وقُبلت سابقاً، أو إن
 * كان الطلب يدوياً. لا يرمي أبداً — فشل قياسٍ لا يجوز أن يُسقِط تغيير حالة
 * حقيقياً.
 */
export async function sendDeferredPurchase(orderId: number): Promise<DeferredPurchaseOutcome> {
  try {
    const [order] = await sql<OrderRow[]>`
      select id, status, source, items_subtotal, public_reference, customer_phone,
             confirmed_at, capi_identity, ga_identity, attribution_last, attribution_first
      from public.orders
      where id = ${orderId}
    `;
    if (!order) return { sent: false, reason: "order_not_found" };

    // مبيعات الموقع وحدها (القرار 4 أعلاه).
    if (order.source !== "website") return { sent: false, reason: "not_website" };

    if (!SALE_CONFIRMED_STATUSES.includes(order.status)) {
      return { sent: false, reason: "not_a_sale" };
    }

    const items = await sql<ReservedLine[]>`
      select product_name_snapshot, sku_snapshot, quantity, unit_price_snapshot
      from public.order_items
      where order_id = ${orderId} and line_status = 'reserved'
    `;
    // طلب بلا سطر محجوز واحد ليس بيعةً نُبلّغ عنها.
    if (items.length === 0) return { sent: false, reason: "nothing_to_send" };

    const meta = await deliverMetaPurchase(order, items);
    // GA4 مستقلّة بحرسها: لو قُبلت Meta سابقاً وفشلت GA4، تُعاد هذه وحدها.
    const gaSent = await deliverGaPurchase(order, items);

    if (meta.kind === "sent") {
      return { sent: true, orderId, eventId: meta.eventId, gaSent };
    }
    return { sent: false, reason: meta.reason, error: meta.error };
  } catch (error) {
    console.error(`sendDeferredPurchase: تعذّر إرسال شراء الطلب ${orderId}`, error);
    return {
      sent: false,
      reason: "delivery_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deliverMetaPurchase(
  order: OrderRow,
  items: ReservedLine[]
): Promise<MetaDelivery> {
  // الحجز الذرّي: من يفوز بهذا الصفّ وحده يُرسل.
  const claimed = await sql<{ id: number }[]>`
    update public.orders
    set meta_purchase_sent_at = now(),
        meta_purchase_attempts = meta_purchase_attempts + 1
    where id = ${order.id}
      and meta_purchase_sent_at is null
      and meta_purchase_attempts < ${MAX_PURCHASE_ATTEMPTS}
    returning id
  `;

  if (claimed.length === 0) {
    // لم نفز بالحجز: إمّا أُرسلت فعلاً، وإمّا استُنفدت المحاولات. نقرأ
    // الحالة من جديد بدل الاعتماد على صفٍّ قُرئ قبل محاولة الحجز.
    const [state] = await sql<{ sent: boolean }[]>`
      select meta_purchase_sent_at is not null as sent
      from public.orders where id = ${order.id}
    `;
    return { kind: "skipped", reason: state?.sent ? "already_sent" : "attempts_exhausted" };
  }

  // الـfbclid من اللقطة أولاً، ثم من إسناد الطلب — الأخير يبقى حتى لو لم
  // تُكتب اللقطة (طلبات أُنشئت قبل هذا العمود).
  const identity = order.capi_identity ?? {};
  const touch = order.attribution_last ?? order.attribution_first ?? null;
  const fbc = resolveFbc({
    cookieFbc: identity.fbc,
    fbclid: identity.fbclid ?? touch?.fbclid,
    fbclidAt: identity.fbclidAt ?? touch?.at,
    host: identity.eventSourceUrl,
  });

  const phone = order.customer_phone ? toInternationalDigits(order.customer_phone) : undefined;
  const value = Number(order.items_subtotal);
  const eventId = purchaseEventId(order.id);

  const result = await sendCapiEvent({
    eventName: "Purchase",
    eventId,
    // لحظة البيعة الحقيقية. `confirmed_at` مضبوط دائماً عند هذه النقطة
    // (actions.ts يكتبه في نفس المعاملة، وcreateManualOrder عند الإنشاء)،
    // والرجوع إلى الآن احتياط لا أكثر.
    eventTimeMs: order.confirmed_at ? new Date(order.confirmed_at).getTime() : Date.now(),
    eventSourceUrl: identity.eventSourceUrl ?? undefined,
    userData: {
      phone,
      // المُعرّف الثابت هو الهاتف نفسه: ثابت عبر الجلسات والأجهزة،
      // وموجود في كل طلب. يرفع المطابقة حين لا fbp ولا fbc.
      externalId: phone,
      clientIpAddress: identity.clientIpAddress ?? undefined,
      clientUserAgent: identity.clientUserAgent ?? undefined,
      fbp: identity.fbp ?? undefined,
      fbc: fbc ?? undefined,
    },
    customData: {
      content_ids: items.map((i) => i.sku_snapshot ?? ""),
      content_type: "product",
      currency: "MAD",
      value: Number.isFinite(value) ? value : 0,
      num_items: items.reduce((sum, i) => sum + i.quantity, 0),
      contents: items.map((i) => ({
        id: i.sku_snapshot ?? "",
        quantity: i.quantity,
        item_price: Number(i.unit_price_snapshot ?? 0),
      })),
    },
  });

  if (result.ok) {
    await sql`
      update public.orders
      set meta_purchase_accepted_at = now(), meta_purchase_error = null
      where id = ${order.id}
    `;
    return { kind: "sent", eventId };
  }

  const message = (result.error ?? "فشل غير موصوف").slice(0, 500);

  // تحرير الحجز **دائماً** عند الفشل، ليُعاد المحاولة على أول تغيير حالة
  // لاحق أو من زرّ الإعادة. آمن لأن `event_id` حتمي: أي وصول مزدوج تُلغيه
  // Meta بنفسها.
  //
  // ولا يُترَك الحجز مستهلكاً بعد السقف: عمودٌ يقول "أُرسل" عن بيعة لم
  // تُرسَل كذبٌ في البيانات، وكان يجعل الاستدعاء التالي يُجيب `already_sent`
  // عن طلب لم تستلمه Meta قطّ. فالصفّ يبقى صادقاً (لا إرسال، سببٌ مكتوب،
  // محاولاتٌ محسوبة)، وشرط `attempts < MAX` في الحجز وحده هو ما يوقف
  // المطاردة — وهو ما يجعل الجواب بعدها `attempts_exhausted` بحقّ.
  await sql`
    update public.orders
    set meta_purchase_sent_at = null, meta_purchase_error = ${message}
    where id = ${order.id}
  `;

  return { kind: "skipped", reason: "delivery_failed", error: message };
}

/**
 * شراء GA4 عند التأكيد، بحرسٍ خاصٍّ به.
 *
 * GA4 **لا تُلغي تكرار `purchase` حسب `transaction_id`** — بيعةٌ تُرسَل
 * مرتين تصير إيراداً مضاعفاً. فلا يحرسها إلا `ga_purchase_sent_at`، وهو
 * السبب الذي جعل هذا الحرس عموداً مستقلاً عن حرس Meta.
 */
async function deliverGaPurchase(order: OrderRow, items: ReservedLine[]): Promise<boolean> {
  if (!isGaMeasurementProtocolConfigured()) return false;

  const clientId = order.ga_identity?.clientId ?? undefined;
  // بلا `client_id` لا معنى للإرسال: GA4 ترفضه أو تنسبه إلى مستخدم مخترع.
  if (!clientId) return false;

  const claimed = await sql<{ id: number }[]>`
    update public.orders
    set ga_purchase_sent_at = now(),
        ga_purchase_attempts = ga_purchase_attempts + 1
    where id = ${order.id}
      and ga_purchase_sent_at is null
      and ga_purchase_attempts < ${MAX_PURCHASE_ATTEMPTS}
    returning id
  `;
  if (claimed.length === 0) return false;

  const ok = await sendGaPurchaseEvent({
    transactionId: order.public_reference,
    value: Number(order.items_subtotal),
    items: items.map((i) => ({
      item_id: i.sku_snapshot ?? "",
      item_name: i.product_name_snapshot ?? (i.sku_snapshot ?? ""),
      price: Number(i.unit_price_snapshot ?? 0),
      quantity: i.quantity,
    })),
    clientId,
    sessionId: order.ga_identity?.sessionId ?? undefined,
  });

  // نفس منطق Meta: الفشل يُحرّر الحجز ليُعاد لاحقاً، والسقف يوقف التكرار.
  if (!ok) {
    await sql`
      update public.orders set ga_purchase_sent_at = null where id = ${order.id}
    `;
  }
  return ok;
}
