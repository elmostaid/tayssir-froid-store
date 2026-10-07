import { sql } from "@/lib/db";
import { sendCapiEvent } from "@/lib/pixel/capi";
import { resolveFbc } from "@/lib/pixel/fbc";
import { toInternationalDigits } from "@/lib/phone";
import { SALE_CONFIRMED_STATUSES, type OrderStatus } from "@/lib/orders/orderStatus";

// عمداً بلا `import "server-only"` — نفس قرار lib/pixel/capi.ts وللسبب
// نفسه: actions.ts تستورد هذا الملف، وعشرات الاختبارات تستورد actions.ts في
// بيئة jsdom، و`server-only` يرمي هناك دائماً (شرط "react-server" لا يُفعَّل
// تحت Vitest) فيُسقِط اختبارات قائمة لا علاقة لها بالقياس. والحماية الفعلية
// قائمة أصلاً: التوكن بلا بادئة NEXT_PUBLIC_ فلا يُضمَّن في حزمة المتصفح
// أبداً — فقط لا تستورد هذا الملف من أي مكوّن "use client".

/**
 * حدث `Purchase` إلى Meta في لحظة التأكيد التجاري — لا في لحظة الإرسال.
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
 * 4.6 ساعة، وأقصاه 15.3 ساعة — ولا طلب واحد تأكّد بعد سبعة أيام (حدّ Meta).
 *
 * **2. الهوية من اللقطة، لا من الطلب الحالي.** الاستدعاء يأتي من فعل
 * المدير، فـIP والـUser-Agent وكوكي `_fbp` في ذلك الطلب كلها للمدير. لو
 * قُرئت لأرسلنا هوية المدير بوصفها هوية الزبون، فتبدو كل التحويلات من شخص
 * واحد — وهو أسوأ من ألّا نُرسل شيئاً. المصدر الوحيد هو `capi_identity`
 * المحفوظة وقت الإرسال.
 *
 * **3. الشراء ليس على `confirmed` حرفياً.** 13 طلباً في الإنتاج (13.7% من
 * المشحونة) وصل `shipped` دون أن يمرّ بـ`confirmed` قطّ. فأي حالة من
 * `SALE_CONFIRMED_STATUSES` اعترافٌ بأن البيعة تمّت.
 *
 * **4. الحجز قبل الإرسال.** العمود يُطالَب به ذرّياً (`where
 * meta_purchase_sent_at is null`) قبل أي نداء لـMeta، فاستدعاءان متوازيان
 * لا يُرسلان مرتين. والمقايضة مقصودة: لو فشل الإرسال بعد الحجز ضاع حدث
 * واحد؛ ولو أُرسل قبل الحجز لاحتُسبت بيعة مرتين. الأول خطأ في القياس،
 * والثاني خطأ يدرّب Meta عليه.
 */

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

export type DeferredPurchaseOutcome =
  | { sent: true; orderId: number; eventId: string }
  | { sent: false; reason: "already_sent" | "not_a_sale" | "order_not_found" | "nothing_to_send" };

/**
 * `event_id` حتمي وخاصّ بالشراء.
 *
 * عمداً ليس `idempotencyKey` (الذي يحمله `OrderSubmitted`): معرّفٌ واحد
 * لحدثين مختلفين يعني أن Meta قد تعتبر أحدهما تكراراً للآخر فتُسقطه.
 * وحتمي حتى تُسقِط Meta أي إرسال ثانٍ لنفس البيعة لو تجاوز الحارس.
 */
export function purchaseEventId(orderId: number): string {
  return `purchase:${orderId}`;
}

type OrderRow = {
  id: number;
  status: OrderStatus;
  items_subtotal: string;
  customer_phone: string | null;
  confirmed_at: Date | null;
  capi_identity: CapiIdentitySnapshot | null;
  attribution_last: { fbclid?: string | null; at?: number | null } | null;
  attribution_first: { fbclid?: string | null; at?: number | null } | null;
};

/**
 * يُرسَل مرة واحدة لكل طلب. آمن للاستدعاء على أي تغيير حالة: يخرج صامتاً
 * إن لم تكن البيعة قد تمّت، أو إن أُرسلت سابقاً. لا يرمي أبداً — فشل قياسٍ
 * لا يجوز أن يُسقِط تغيير حالة حقيقياً.
 */
export async function sendDeferredPurchase(orderId: number): Promise<DeferredPurchaseOutcome> {
  try {
    const [order] = await sql<OrderRow[]>`
      select id, status, items_subtotal, customer_phone, confirmed_at,
             capi_identity, attribution_last, attribution_first
      from public.orders
      where id = ${orderId}
    `;
    if (!order) return { sent: false, reason: "order_not_found" };

    if (!SALE_CONFIRMED_STATUSES.includes(order.status)) {
      return { sent: false, reason: "not_a_sale" };
    }

    const items = await sql<
      { sku_snapshot: string | null; quantity: number; unit_price_snapshot: string | null }[]
    >`
      select sku_snapshot, quantity, unit_price_snapshot
      from public.order_items
      where order_id = ${orderId} and line_status = 'reserved'
    `;
    // طلب بلا سطر محجوز واحد ليس بيعةً نُبلّغ عنها.
    if (items.length === 0) return { sent: false, reason: "nothing_to_send" };

    // الحجز الذرّي: من يفوز بهذا الصفّ وحده يُرسل.
    const claimed = await sql<{ id: number }[]>`
      update public.orders
      set meta_purchase_sent_at = now()
      where id = ${orderId} and meta_purchase_sent_at is null
      returning id
    `;
    if (claimed.length === 0) return { sent: false, reason: "already_sent" };

    const identity = order.capi_identity ?? {};
    // الـfbclid من اللقطة أولاً، ثم من إسناد الطلب — الأخير يبقى حتى لو لم
    // تُكتب اللقطة (طلبات أُنشئت قبل هذا العمود).
    const touch = order.attribution_last ?? order.attribution_first ?? null;
    const fbc = resolveFbc({
      cookieFbc: identity.fbc,
      fbclid: identity.fbclid ?? touch?.fbclid,
      fbclidAt: identity.fbclidAt ?? touch?.at,
      host: identity.eventSourceUrl,
    });

    const phone = order.customer_phone ? toInternationalDigits(order.customer_phone) : undefined;
    const value = Number(order.items_subtotal);
    const eventId = purchaseEventId(orderId);

    await sendCapiEvent({
      eventName: "Purchase",
      eventId,
      // لحظة البيعة الحقيقية. `confirmed_at` مضبوط دائماً عند هذه النقطة
      // (actions.ts يكتبه في نفس المعاملة)، والرجوع إلى الآن احتياط لا أكثر.
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

    return { sent: true, orderId, eventId };
  } catch (error) {
    console.error(`sendDeferredPurchase: تعذّر إرسال شراء الطلب ${orderId}`, error);
    return { sent: false, reason: "nothing_to_send" };
  }
}
