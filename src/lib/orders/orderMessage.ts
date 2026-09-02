import type { CartItem } from "@/lib/cart/types";
import { formatMad } from "@/lib/format";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { customerAddressOrNull } from "@/lib/orders/customerAddress";

/**
 * رسالة الطلب على واتساب — بسقف صارم لطول الرابط.
 *
 * الرسالة القديمة كانت تسرد كل سطر في السلة بالاسم الكامل داخل `?text=`،
 * والحرف العربي يصير 9 بايت بعد الترميز. قِسنا على كتالوغ Production: سلة
 * من 80 سطراً تُنتج رابطاً بـ17 كيلوبايت، وسلة تشمل الكتالوغ كله تصل إلى
 * 43 كيلوبايت. الزبون صاحب السلة الكبيرة كان يضغط الزر فيبقى على الموقع ثم
 * يرى "This page couldn't load" — بينما السلات الصغيرة تعمل. لذلك صار لطول
 * الرابط سقف لا يُتجاوَز أبداً، مهما كبرت السلة.
 *
 * وصيغتان لا واحدة، لأن الحفظ قد يفشل:
 *
 *  • **مؤكَّدة** — الطلب محفوظ فعلاً وله رقم. لا داعي لسرد المنتجات في
 *    واتساب، فالتفاصيل كلها في لوحة الإدارة تحت رقم الطلب.
 *
 *  • **إنقاذ** — لم يتأكّد الحفظ قبل خروج الزبون. هنا لا يجوز الاعتماد على
 *    قاعدة البيانات إطلاقاً: نضع محتوى الطلب في الرسالة نفسها، لكن بصيغة
 *    مضغوطة (SKU × الكمية) بلا أسماء طويلة — فتبقى الطلبية قابلة للتنفيذ
 *    يدوياً حتى لو ضاع الحفظ نهائياً.
 *
 * المرجع في الحالتين يُولَّد في المتصفح قبل أي اتصال بالخادم، فهو موجود حتى
 * حين لا يوجد رقم طلب إطلاقاً.
 */

/**
 * سقف طول رابط واتساب بالبايت.
 *
 * 6500 هامش أمان واسع: السلال التي لم تفشل قطّ تُنتج ~1.6 كيلوبايت، بينما
 * التي أسقطت متصفّح فيسبوك كانت 16-43 كيلوبايت. عند هذا السقف تدخل سلة
 * الأربعين منتجاً كاملةً بالأسماء، ويظهر من السلال الأكبر نحو خمسين اسماً.
 */
export const MAX_WHATSAPP_URL_BYTES = 6500;

const CLOSING_NOTE =
  "(المجموع لا يشمل التوصيل — يُحسب بعد تجهيز الطلب)";

/**
 * مرجع عشوائي لمسار لا يمرّ بحفظ طلب إطلاقاً (زرّ واتساب من السلة).
 *
 * **لا يستدعي `crypto.randomUUID` عمداً.** أغلب زبائن هذا المتجر داخل
 * متصفّح فيسبوك أو إنستغرام الداخلي، و`randomUUID` غائب في جزء حقيقي منها
 * (يلزمها WebView حديث وسياق آمن) — نفس السبب الذي جعل `analytics/session.ts`
 * يحمل بديلاً يدوياً. واستدعاؤه هنا داخل `useState` كان سيرمي أثناء العرض،
 * أي **صفحة سلة بيضاء** لمن كان الزر موجَّهاً إليه أصلاً. ولا نحتاج أصلاً
 * ضمانات UUID: ثمانية أرقام سُداسية تكفي لتمييز محادثة عن أخرى.
 */
export function randomOrderReference(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return orderReferenceFromKey(hex);
}

/** مرجع قصير مقروء يُشتقّ من idempotencyKey، متاح قبل أي حفظ. */
export function orderReferenceFromKey(idempotencyKey: string): string {
  const compact = idempotencyKey.replace(/[^0-9a-fA-F]/g, "").slice(0, 8).toUpperCase();
  return `W-${compact || "00000000"}`;
}

export type MessageCustomer = {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  notes: string;
};

function customerLines(storeName: string, customer: MessageCustomer, reference: string): string[] {
  const lines = [
    `طلب جديد من موقع ${storeName}`,
    `المرجع: ${reference}`,
    "",
    `الاسم الكامل: ${customer.fullName}`,
    `الهاتف: ${customer.phone}`,
    `المدينة: ${customer.city}`,
  ];
  // بلا عنوان لا نكتب سطراً فارغاً ولا «غير محدد»: من يجهّز الطلب يقرأ
  // الرسالة على الهاتف، وسطرٌ لا يحمل معلومة يزاحم ما يحمل — وكل بايت
  // محسوب هنا لأن الرسالة كلها محكومة بسقف MAX_WHATSAPP_URL_BYTES.
  const address = customerAddressOrNull(customer.address);
  if (address) lines.push(`العنوان: ${address}`);
  if (customer.notes.trim()) lines.push(`ملاحظات: ${customer.notes.trim()}`);
  return lines;
}

/**
 * يُقصّر الاسم مع الحفاظ على هويّة المنتج: القطع عند حدّ كلمة لا وسطها،
 * فيبقى «غاز تبريد R410 للمكيفات…» مفهوماً لمن يجهّز الطلب.
 */
export function shortenProductName(name: string, maxChars: number): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  // لا نقبل قصّاً يمحو أكثر من ثلث المسموح، وإلا صار الاسم بلا معنى.
  const base = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * سُلّم الصيغ من الأغنى إلى الأقل، ونأخذ أول ما يدخل تحت السقف بكل سطوره.
 * SKU زينة تُحذف أولاً، ثم يُقصَّر الاسم تدريجياً — والاسم آخر ما نتنازل
 * عنه لأنه وحده ما يجعل البون قابلاً للتجهيز.
 */
const NAME_TIERS: { nameMax: number; withSku: boolean }[] = [
  { nameMax: 60, withSku: true },
  { nameMax: 60, withSku: false },
  { nameMax: 36, withSku: false },
];

/**
 * حين لا تسع السلةُ الرسالةَ مهما فعلنا، لا نُمعن في قصّ الأسماء: النزول
 * إلى 16 حرفاً كان يشتري بضعة سطور فقط ويُفسد كل اسم فيها. الأفضل أسماء
 * مقروءة لعدد أقل، والباقي يُطلَب بالمرجع.
 */
const OVERFLOW_TIER = { nameMax: 36, withSku: false };

function itemLine(item: CartItem, nameMax: number, withSku: boolean): string {
  const full = item.variantName ? `${item.name} — ${item.variantName}` : item.name;
  const name = shortenProductName(full, nameMax);
  return withSku ? `${name} (${item.sku}) × ${item.quantity}` : `${name} × ${item.quantity}`;
}

/** الطلب محفوظ وله رقم — التفاصيل في اللوحة، فلا نكرّرها هنا. */
export function buildConfirmedOrderMessage(params: {
  storeName: string;
  customer: MessageCustomer;
  reference: string;
  orderNumber: string;
  items: CartItem[];
  subtotal: number;
  whatsappNumber: string;
  /** سطور لم يُحجز مخزونها — الطلب مسجَّل لكنه يحتاج مراجعة قبل التجهيز. */
  needsReview?: boolean;
  maxUrlBytes?: number;
}): string {
  const { storeName, customer, reference, orderNumber, items, subtotal, whatsappNumber } = params;
  const budget = params.maxUrlBytes ?? MAX_WHATSAPP_URL_BYTES;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const head = customerLines(storeName, customer, reference);

  // المجموع لا يُسمّى نهائياً ما دام سطرٌ ينتظر مراجعة المخزون.
  const totalLabel = params.needsReview
    ? `المجموع المطلوب قبل مراجعة المخزون ${formatMad(subtotal)}`
    : `المجموع ${formatMad(subtotal)}`;

  const compose = (lines: string[], hidden: number) => {
    const body = [
      ...head,
      "",
      `رقم الطلب: ${orderNumber}`,
      `${items.length} منتجاً (${units} قطعة)`,
    ];
    if (params.needsReview) {
      body.push("⚠ الطلب تسجّل ويحتاج مراجعة مخزون بعض المنتجات قبل التجهيز.");
    }
    body.push(...lines.map((line) => `- ${line}`));
    if (hidden > 0) {
      body.push(`+${hidden} منتجات أخرى محفوظة كاملة في الطلب ${orderNumber}`);
    }
    body.push("", totalLabel, CLOSING_NOTE);
    return body.join("\n");
  };

  const fits = (message: string) =>
    buildWhatsAppLink(whatsappNumber, message).length <= budget;

  for (const tier of NAME_TIERS) {
    const message = compose(items.map((i) => itemLine(i, tier.nameMax, tier.withSku)), 0);
    if (fits(message)) return message;
  }
  const all = items.map((i) => itemLine(i, OVERFLOW_TIER.nameMax, OVERFLOW_TIER.withSku));
  for (let shown = all.length - 1; shown >= 1; shown--) {
    const message = compose(all.slice(0, shown), all.length - shown);
    if (fits(message)) return message;
  }
  return compose([], items.length);
}

/**
 * لم يتأكّد الحفظ — نحمل الطلب في الرسالة نفسها، **بأسماء بشرية**.
 *
 * الصيغة الأولى كانت `SKU×الكمية`. حمَت المتصفّح من الروابط الضخمة لكنها
 * أهدرت البون: الموظّف لا يحفظ الأكواد، فوصلته ورقة أرقام لا طلبية. الاسم
 * الآن هو الثابت الذي لا يُستبدَل أبداً؛ ما يُتنازل عنه عند ضيق السقف هو
 * SKU ثم طول الاسم، وأخيراً عدد السطور المذكورة — مع إحالة صريحة إلى
 * لوحة الإدارة تحت نفس المرجع.
 */
export function buildRescueOrderMessage(params: {
  storeName: string;
  customer: MessageCustomer;
  reference: string;
  items: CartItem[];
  subtotal: number;
  whatsappNumber: string;
  maxUrlBytes?: number;
}): string {
  const { storeName, customer, reference, items, subtotal, whatsappNumber } = params;
  const budget = params.maxUrlBytes ?? MAX_WHATSAPP_URL_BYTES;
  const head = customerLines(storeName, customer, reference);
  const units = items.reduce((sum, item) => sum + item.quantity, 0);

  const compose = (lines: string[], hidden: number) => {
    const body = [
      ...head,
      "",
      `الطلبية: ${items.length} منتجاً (${units} قطعة) — لم يُؤكَّد الحفظ، هذه نسخة إنقاذ:`,
      ...lines.map((line) => `- ${line}`),
    ];
    if (hidden > 0) {
      // صياغة لا تَعِد بما قد لا يوجد: هذه نسخة إنقاذ، أي أن الحفظ لم
      // يُؤكَّد — فقد لا يكون الطلب في اللوحة أصلاً.
      body.push(
        `… و${hidden} منتجاً آخر. ابحثوا عن المرجع ${reference} في لوحة الإدارة، ` +
          "وإن لم تجدوه فاتصلوا بالزبون لتأكيد الباقي."
      );
    }
    body.push("", `المجموع ${formatMad(subtotal)}`, CLOSING_NOTE);
    return body.join("\n");
  };

  const fits = (message: string) =>
    buildWhatsAppLink(whatsappNumber, message).length <= budget;

  // ١) أغنى صيغة تدخل بكل المنتجات.
  for (const tier of NAME_TIERS) {
    const message = compose(items.map((i) => itemLine(i, tier.nameMax, tier.withSku)), 0);
    if (fits(message)) return message;
  }

  // ٢) لا صيغة تسع الكل — نُبقي الأسماء (لا نستبدلها بأكواد أبداً) ونُنقص
  //    عدد السطور، والباقي يُطلَب من اللوحة بالمرجع.
  const all = items.map((i) => itemLine(i, OVERFLOW_TIER.nameMax, OVERFLOW_TIER.withSku));
  for (let shown = all.length - 1; shown >= 1; shown--) {
    const message = compose(all.slice(0, shown), all.length - shown);
    if (fits(message)) return message;
  }
  return compose([], items.length);
}

/**
 * طلب يبدأ من السلة مباشرة، بلا نموذج.
 *
 * **لماذا هذه صيغة ثالثة ولا تكفي buildRescueOrderMessage.** الاثنتان
 * السابقتان تفترضان أن الزبون عبَر النموذج، فتبدآن بالاسم والهاتف والمدينة.
 * هذا المسار وُجد تحديداً لمن لا يعبره: القياس على تسعة أيام يقول إن
 * متصفّح فيسبوك الداخلي أنتج 40 بداية طلب و8 طلبات فقط (20%)، مقابل 60%
 * من متصفّح إنستغرام — والفارق الوحيد بينهما هو مَن يُكمل ثلاثة حقول على
 * لوحة مفاتيح داخل تطبيق. فكتابة «الاسم: » فارغاً هنا كذبٌ على من يجهّز
 * الطلب؛ الصواب أن تقول الرسالة صراحة إن البيانات ستُؤخذ في المحادثة.
 *
 * وما تحمله بدلها هو ما لا يستطيع البائع استرجاعه من المحادثة: المنتجات
 * والكميات والمجموع ومرجع قصير يربط الرسالة بجلسة الزائر (utm/الحملة).
 * بدون المرجع تصير كل طلبات واتساب مجهولة المصدر، فلا نعرف أي إعلان باع.
 *
 * نفس سقف الطول ونفس سُلّم التنازل المستعمل فالصيغتين الأخريين — الرابط
 * الضخم هو ما كان يُسقط متصفّح فيسبوك أصلاً، والمسار الجديد لا يجوز أن
 * يُعيد إنتاج العطل الذي وُجد ليتفاداه.
 */
export function buildCartWhatsAppMessage(params: {
  storeName: string;
  reference: string;
  items: CartItem[];
  subtotal: number;
  whatsappNumber: string;
  /** مصدر الزيارة مختصراً (مثلاً "facebook / cpc") — يُكتب سطراً واحداً. */
  attributionNote?: string | null;
  maxUrlBytes?: number;
}): string {
  const { storeName, reference, items, subtotal, whatsappNumber } = params;
  const budget = params.maxUrlBytes ?? MAX_WHATSAPP_URL_BYTES;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const note = params.attributionNote?.trim();

  const compose = (lines: string[], hidden: number) => {
    const body = [
      `طلب من موقع ${storeName}`,
      `المرجع: ${reference}`,
    ];
    if (note) body.push(`المصدر: ${note}`);
    body.push(
      "",
      `الطلبية: ${items.length} منتجاً (${units} قطعة)`,
      ...lines.map((line) => `- ${line}`)
    );
    if (hidden > 0) {
      body.push(`… و${hidden} منتجاً آخر — سأذكرها في المحادثة.`);
    }
    body.push(
      "",
      `المجموع ${formatMad(subtotal)}`,
      CLOSING_NOTE,
      "",
      "بغيت نكمل هاد الطلب. غادي نعطيكم الاسم والمدينة والهاتف هنا."
    );
    return body.join("\n");
  };

  const fits = (message: string) =>
    buildWhatsAppLink(whatsappNumber, message).length <= budget;

  for (const tier of NAME_TIERS) {
    const message = compose(items.map((i) => itemLine(i, tier.nameMax, tier.withSku)), 0);
    if (fits(message)) return message;
  }
  const all = items.map((i) => itemLine(i, OVERFLOW_TIER.nameMax, OVERFLOW_TIER.withSku));
  for (let shown = all.length - 1; shown >= 1; shown--) {
    const message = compose(all.slice(0, shown), all.length - shown);
    if (fits(message)) return message;
  }
  return compose([], items.length);
}
