/**
 * مسودّة الطلب اليدوي في المتصفح — حتى لا يضيع طلبٌ طويل (عشرات المنتجات
 * وبيانات الزبون) إن انهارت الصفحة أو حُدِّثت بالخطأ أو انقطع الاتصال.
 *
 * ## لماذا sessionStorage لا localStorage
 *
 * المسودّة تحمل اسم الزبون وهاتفه وعنوانه وأثمنة الشراء. sessionStorage
 * يعيش في **هذا التبويب وحده**: يبقى بعد إعادة التحميل وبعد شاشة الخطأ
 * (وهذا كل المطلوب)، ويُمحى وحده عند إغلاق التبويب، فلا يبقى في جهاز مشترك
 * ولا يقرأه تبويب آخر. ومع ذلك نضع سقفاً زمنياً (12 ساعة) ونمسحها فور نجاح
 * الحفظ أو حين يختار المدير «احذف المسودّة».
 *
 * ## مفتاح المحاولة يُحفظ معها
 *
 * `attemptKey` هو مفتاح منع التكرار (`orders.idempotency_key`). لو حُفظت
 * الطلبية فعلاً ثم ضاع الجواب في انقطاع، ثم استُرجعت المسودّة وأُعيد
 * الإرسال، فنفس المفتاح يُرجع **نفس الطلبية** بلا سطر جديد ولا خصم مخزون
 * ثانٍ ولا Purchase ثانٍ. مفتاح جديد هنا كان سيعني طلبية مكرَّرة.
 *
 * كل الوصول إلى التخزين داخل try/catch: التصفّح الخاص، أو التخزين الممتلئ،
 * أو المحظور، لا يجوز أن يكسر النموذج نفسه — المسودّة تحسين لا شرط.
 */

export const MANUAL_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

export type DraftLine = {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  purchasePrice: number | null;
  stockQuantity: number;
  reservedQuantity: number;
};

export type DraftCustomer = {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  source: string;
  originReference: string;
  notes: string;
  adConsentDeclared: boolean;
  actualDeliveryCost: string;
};

export type ManualOrderDraft = {
  v: 1;
  savedAt: number;
  attemptKey: string | null;
  customer: DraftCustomer;
  lines: DraftLine[];
  deliveryFee: number;
};

export function manualDraftStorageKey(leadId?: number | null): string {
  return leadId ? `tf:manual-order-draft:lead:${leadId}` : "tf:manual-order-draft";
}

/** مسودّة فيها شيء يستحق الاسترجاع (لا نعرض «استرجع» لنموذج فارغ). */
export function isMeaningfulDraft(draft: Pick<ManualOrderDraft, "customer" | "lines">): boolean {
  const c = draft.customer;
  return (
    draft.lines.length > 0 ||
    [c.fullName, c.phone, c.city, c.address, c.notes, c.originReference].some((v) => v.trim() !== "")
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** قراءة دفاعية: أي شكل غير متوقَّع = لا مسودّة، لا انهيار. */
export function parseManualDraft(raw: string | null, now = Date.now()): ManualOrderDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<ManualOrderDraft>;
    if (d?.v !== 1 || !isNum(d.savedAt) || now - d.savedAt > MANUAL_DRAFT_TTL_MS) return null;
    const c = d.customer as Partial<DraftCustomer> | undefined;
    if (!c || ![c.fullName, c.phone, c.city, c.address, c.source, c.originReference, c.notes, c.actualDeliveryCost].every(isStr))
      return null;
    if (!Array.isArray(d.lines) || !isNum(d.deliveryFee)) return null;
    const lines = d.lines.filter(
      (l): l is DraftLine =>
        !!l &&
        isNum(l.productId) &&
        isStr(l.sku) &&
        isStr(l.name) &&
        isNum(l.quantity) &&
        isNum(l.unitPrice) &&
        (l.purchasePrice === null || isNum(l.purchasePrice)) &&
        isNum(l.stockQuantity) &&
        isNum(l.reservedQuantity)
    );
    return {
      v: 1,
      savedAt: d.savedAt,
      attemptKey: isStr(d.attemptKey) ? d.attemptKey : null,
      customer: { ...(c as DraftCustomer), adConsentDeclared: c.adConsentDeclared === true },
      lines,
      deliveryFee: d.deliveryFee,
    };
  } catch {
    return null;
  }
}

export function loadManualDraft(key: string): ManualOrderDraft | null {
  const s = storage();
  if (!s) return null;
  try {
    const draft = parseManualDraft(s.getItem(key));
    if (!draft) s.removeItem(key);
    return draft;
  } catch {
    return null;
  }
}

export function saveManualDraft(key: string, draft: Omit<ManualOrderDraft, "v" | "savedAt">): void {
  const s = storage();
  if (!s) return;
  try {
    if (!isMeaningfulDraft(draft)) {
      s.removeItem(key);
      return;
    }
    s.setItem(key, JSON.stringify({ v: 1, savedAt: Date.now(), ...draft }));
  } catch {
    // التخزين ممتلئ أو محظور: النموذج يعمل بلا مسودّة.
  }
}

export function clearManualDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // لا شيء.
  }
}
