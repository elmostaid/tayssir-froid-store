// طبقة نداء GA4 (gtag) الآمنة من جهة العميل فقط — لا تُستورَد أبداً من أي
// كود خادم. مبنيّة على نفس مبدأ lib/pixel/fbq.ts: كل دالة هنا لا تفعل شيئاً
// بصمت إن تعذّر الإرسال، ولا ترمي أي استثناء أبداً. فشل القياس يجب أن يمرّ
// دون أن يلاحظه الزبون — الموقع يبيع قطع غيار، لا يجمع إحصاءات.
//
// مستقل تماماً عن Meta Pixel: لا يستورد شيئاً من lib/pixel ولا يشاركه أي
// حالة أو كائن عام (gtag/dataLayer هنا، fbq هناك)، فتعطّل أحدهما لا يمسّ
// الآخر — نفس الفصل القائم أصلاً بين Meta والقياس الداخلي.
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const CURRENCY = "MAD" as const;

/** أحداث ecommerce الأربعة التي نرسلها. قائمة مغلقة عمداً. */
export type GaEcommerceEventName = "view_item" | "add_to_cart" | "begin_checkout" | "purchase";

/** منتج واحد كما يفهمه GA4 (item_id/item_name/price/quantity). */
export type GaItem = {
  sku: string;
  name: string;
  price: number;
  quantity: number;
  category?: string | null;
  /** المقاس/النوع المختار إن وُجد — item_variant في GA4. */
  variant?: string | null;
};

function toGaItems(items: GaItem[]) {
  return items.map((item) => ({
    item_id: item.sku,
    item_name: item.name,
    price: item.price,
    quantity: item.quantity,
    ...(item.category ? { item_category: item.category } : {}),
    ...(item.variant ? { item_variant: item.variant } : {}),
  }));
}

function sumValue(items: GaItem[]): number {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

/**
 * الطابور القصير: لماذا لا نكتفي بنداء gtag مباشرة.
 *
 * الوسم الأساسي يُحمَّل بـstrategy="afterInteractive"، أي أن السطر الذي
 * يُعرّف gtag ويُنفّذ gtag('config', ...) يُحقن بعد الترطيب. و view_item
 * يُطلَق من useEffect عند الترطيب نفسه — فقد يسبق تعريف gtag بأجزاء من
 * الثانية ويضيع. والأسوأ من الضياع أن نكتب في dataLayer مباشرة قبل config:
 * gtag.js يتجاهل أي حدث يسبق تهيئة الخاصية، فيبدو مُرسَلاً وهو غير محتسَب.
 *
 * لذلك ننتظر ظهور gtag نفسه ثم نُفرّغ بالترتيب. الانتظار مسقوف: بعد
 * MAX_WAIT_MS نُسقط ما تبقّى بصمت (حاجب إعلانات، أو شبكة لم تُنزل السكريبت)
 * بدل تركه ينمو في الذاكرة.
 */
const RETRY_INTERVAL_MS = 200;
const MAX_WAIT_MS = 10_000;

type QueuedEvent = { name: GaEcommerceEventName; params: Record<string, unknown> };

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let waitedMs = 0;

function stopWaiting(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  waitedMs = 0;
}

function drainQueue(): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  const pending = queue;
  queue = [];
  stopWaiting();
  for (const event of pending) {
    try {
      window.gtag("event", event.name, event.params);
    } catch {
      // حدث واحد فاشل لا يمنع البقية.
    }
  }
}

function startWaiting(): void {
  if (timer !== null || typeof window === "undefined") return;
  timer = setInterval(() => {
    waitedMs += RETRY_INTERVAL_MS;
    if (typeof window.gtag === "function") {
      drainQueue();
      return;
    }
    if (waitedMs >= MAX_WAIT_MS) {
      queue = [];
      stopWaiting();
    }
  }, RETRY_INTERVAL_MS);
}

/**
 * إرسال حدث واحد. يعود فوراً دائماً ولا يرمي أبداً.
 *
 * أحداث فقط: لا gtag('config') ولا gtag('js') هنا إطلاقاً — الوسم الأساسي
 * في GoogleAnalytics.tsx هو الموضع الوحيد لهما، وتكرارهما هنا كان سيُنتج
 * page_view ثانياً لكل صفحة.
 */
function sendGaEvent(name: GaEcommerceEventName, params: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof window.gtag === "function") {
      // نُفرّغ ما سبق أولاً حتى يبقى الترتيب الزمني صحيحاً.
      if (queue.length > 0) drainQueue();
      window.gtag("event", name, params);
      return;
    }
    queue.push({ name, params });
    startWaiting();
  } catch {
    // القياس لا يُسقط صفحة أبداً.
  }
}

/** عرض صفحة منتج. القيمة هي ثمن الوحدة — نفس ما يرسله ViewContent لـMeta. */
export function trackGaViewItem(item: Omit<GaItem, "quantity">): void {
  const items = [{ ...item, quantity: 1 }];
  sendGaEvent("view_item", {
    currency: CURRENCY,
    value: item.price,
    items: toGaItems(items),
  });
}

/** إضافة فعلية إلى السلة. القيمة = ثمن الوحدة × الكمية المُضافة. */
export function trackGaAddToCart(item: GaItem): void {
  sendGaEvent("add_to_cart", {
    currency: CURRENCY,
    value: item.price * item.quantity,
    items: toGaItems([item]),
  });
}

/** بدء Checkout بسلة غير فارغة. القيمة = مجموع السلة. */
export function trackGaBeginCheckout(params: { items: GaItem[]; value?: number }): void {
  sendGaEvent("begin_checkout", {
    currency: CURRENCY,
    value: params.value ?? sumValue(params.items),
    items: toGaItems(params.items),
  });
}

/**
 * شراء. transaction_id هو المرجع العام للطلب المحفوظ فعلاً — قيمة واحدة
 * لكل طلب حقيقي، وهي نفسها التي تظهر في لوحة الإدارة. GA4 يستبعد أي
 * purchase يتكرّر بنفس transaction_id، فهذا خط الدفاع الثاني بعد الحارس
 * الموجود في موضع الاستدعاء.
 */
export function trackGaPurchase(params: {
  transactionId: string;
  items: GaItem[];
  value?: number;
}): void {
  sendGaEvent("purchase", {
    transaction_id: params.transactionId,
    currency: CURRENCY,
    value: params.value ?? sumValue(params.items),
    items: toGaItems(params.items),
  });
}

/** للاختبارات فقط — تفريغ الطابور والمؤقّت بين الحالات. */
export function __resetGaQueueForTests(): void {
  queue = [];
  stopWaiting();
}
