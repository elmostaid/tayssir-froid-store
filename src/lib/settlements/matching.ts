import { formatMad } from "@/lib/format";
import type { CarrierParcelStatus } from "./bigDeliveryInvoice";
import { compareCities, type CityCheck } from "./cityMatch";
import type { Cents } from "./money";

/**
 * محرّك المطابقة — دالة خالصة بلا قاعدة بيانات، تُختبَر وحدها.
 *
 * المدخل: كل الكرطونات «المفتوحة» (فعّالة ولم تُسوَّ بعد، من كل الفواتير معاً)،
 * والطلبيات المرشّحة بنفس الهواتف. المخرج: حكم لكل طلبية وكل كرطونة.
 *
 * **لماذا كل الفواتير معاً لا الفاتورة الأخيرة وحدها:** كرطونات طلبية واحدة قد
 * تصل في فاتورتين أو ثلاث (0415 = 718 + 777 في فاتورة 1761، والباقي 1,616 في
 * فاتورة لاحقة). الحساب من جديد على كل المفتوح يجعل الطلبية تكتمل تلقائياً
 * يوم تصل كرطونتها الأخيرة، بلا ربطٍ يدوي ولا حالة وسيطة محفوظة قد تنحرف.
 *
 * **قواعد لا استثناء فيها:**
 * - المبلغ يتطابق بالسنتيم أو لا تطابق. لا هامش.
 * - طلبية واحدة مرشّحة، أو مجموعة كرطونات واحدة فقط تساوي مبلغ طلبية واحدة.
 *   غير ذلك = غامض = لا شيء يُطبَّق تلقائياً.
 * - كرطونة مرجوعة أو مرفوضة لا تُطبَّق تلقائياً أبداً («returned» في الموقع
 *   يُرجع المخزون، فلا يقرّره إلا المالك).
 * - مجموع المبالغ وحده لا يثبت وصول كل الكرطونات حين يكون عددها غير مسجَّل:
 *   الطلبية تبقى «جاهزة» لكن بثقة «متوسطة» معلنة، لا «عالية».
 */

export type OpenParcel = {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  trackingCode: string;
  phoneKey: string | null;
  city: string | null;
  codCents: Cents;
  feeCents: Cents;
  status: CarrierParcelStatus;
  statusRaw: string | null;
  pickupDate: string | null;
};

export type CandidateOrder = {
  id: number;
  orderNumber: string;
  status: string;
  phoneKey: string;
  city: string | null;
  createdAt: string;
  finalTotalCents: Cents | null;
  deliveryFeeCents: Cents | null;
  cartonCount: number | null;
  actualDeliveryCostCents: Cents | null;
  /** عندها تسوية فعّالة سابقة — لا تأخذ كرطونات جديدة. */
  settled: boolean;
};

export type Confidence = "high" | "medium";

/**
 * ready    جاهزة: تُطبَّق بالموافقة الجماعية.
 * decide   مطابقة سليمة الأرقام، لكن فيها ما يستحق قرار المالك (تكلفة يدوية
 *          مختلفة، مدينة مختلفة، حالة مؤكَّدة لم تُرسَل). تُطبَّق فقط إن وافق عليها.
 * blocked  لا تُطبَّق من هنا أصلاً (إرجاع، مبلغ زائد، طلبية ملغاة…).
 * waiting  ناقصها كرطونات — تكتمل وحدها مع فاتورة لاحقة.
 */
export type OrderVerdictKind = "ready" | "decide" | "blocked" | "waiting";

export type OrderVerdict = {
  kind: OrderVerdictKind;
  order: CandidateOrder;
  parcels: OpenParcel[];
  codCents: Cents;
  feeCents: Cents;
  missingCents: Cents;
  confidence: Confidence;
  city: CityCheck;
  /** لماذا ليست «جاهزة» (decide/blocked/waiting). */
  reasons: string[];
  /** لماذا الثقة متوسطة لا عالية. */
  confidenceNotes: string[];
  /** سبب المطابقة: الأدلة التي ربطت الكرطونات بهذه الطلبية، سطراً سطراً. */
  evidence: string[];
  /** معلَّمة مسبقاً للتطبيق؟ الثقة العالية وحدها — المتوسطة يختارها المالك. */
  preselect: boolean;
  willSetDelivered: boolean;
  willSetCost: boolean;
  costConflict: boolean;
};

export type ParcelGroupVerdict = {
  kind: "unmatched" | "ambiguous" | "extra";
  parcels: OpenParcel[];
  candidates: CandidateOrder[];
  reason: string;
};

export type MatchingResult = {
  orders: OrderVerdict[];
  parcelGroups: ParcelGroupVerdict[];
};

/** الحالات التي تُطبَّق فيها التسوية تلقائياً. */
const AUTO_STATUSES = new Set(["shipped", "delivered"]);
/** مؤكَّدة تجارياً لكن لم تُعلَّم «مُرسَلة»: تُطبَّق بموافقة صريحة فقط. */
const DECIDE_STATUSES = new Set(["confirmed", "preparing"]);

const STATUS_LABELS: Record<string, string> = {
  new: "جديدة",
  needs_review: "تحتاج مراجعة",
  contacted: "تم التواصل",
  confirmed: "مؤكَّدة",
  preparing: "قيد التجهيز",
  shipped: "مُرسَلة",
  delivered: "مسلَّمة",
  cancelled: "ملغاة",
  returned: "راجعة",
};

/** الكرطونة تُستلَم بعد الطلب، ولا تتأخّر عنه أكثر من هذا. */
const PICKUP_WINDOW_DAYS = 45;
/** سقف تعداد المجموعات الجزئية (2^14 = 16k) — أكثر من هذا لهاتف واحد = غامض. */
const MAX_SUBSET_PARCELS = 14;

const mad = (c: number) => formatMad(c / 100);

function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(isoDate.slice(0, 10) + "T00:00:00Z") / 86400000);
}

function parcelFitsOrder(p: OpenParcel, o: CandidateOrder): boolean {
  if (!p.pickupDate) return true;
  const pickup = dayNumber(p.pickupDate);
  const created = dayNumber(o.createdAt);
  return pickup >= created && pickup <= created + PICKUP_WINDOW_DAYS;
}

function sum(parcels: OpenParcel[], key: "codCents" | "feeCents"): Cents {
  return parcels.reduce((s, p) => s + p[key], 0);
}

/** كل المجموعات الجزئية غير الفارغة التي مجموع تحصيلها = target. */
function exactSubsets(parcels: OpenParcel[], target: Cents): OpenParcel[][] {
  const out: OpenParcel[][] = [];
  const n = parcels.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s += parcels[i].codCents;
    if (s === target) out.push(parcels.filter((_, i) => mask & (1 << i)));
  }
  return out;
}

function cityOf(parcels: OpenParcel[], order: CandidateOrder): CityCheck {
  const checks = parcels.map((p) => compareCities(p.city, order.city));
  if (checks.includes("match")) return "match";
  if (checks.includes("differ")) return "differ";
  return "unknown";
}

function matchEvidence(
  order: CandidateOrder,
  parcels: OpenParcel[],
  codCents: Cents,
  city: CityCheck
): string[] {
  const out = ["الهاتف مطابق (آخر 9 أرقام)."];
  if (order.finalTotalCents !== null) {
    out.push(
      codCents === order.finalTotalCents
        ? `المحصَّل ${mad(codCents)} = المبلغ النهائي ديال الطلبية بالضبط.`
        : `المحصَّل ${mad(codCents)} من ${mad(order.finalTotalCents)}.`
    );
  }
  const created = dayNumber(order.createdAt);
  const days = parcels
    .map((p) => (p.pickupDate ? dayNumber(p.pickupDate) - created : null))
    .filter((d): d is number => d !== null);
  if (days.length > 0) {
    const lo = Math.min(...days);
    const hi = Math.max(...days);
    out.push(`الاستلام من بعد الطلبية بـ${lo === hi ? lo : `${lo}–${hi}`} يوم.`);
  }
  out.push(
    city === "match"
      ? "المدينة مطابقة."
      : city === "differ"
        ? "المدينة مختلفة."
        : "المدينة ما تقارناتش."
  );
  out.push(
    order.cartonCount === null
      ? `${parcels.length} كرطونة — العدد ما مسجلش فالطلبية.`
      : `${parcels.length} من ${order.cartonCount} كرطونات المسجلة.`
  );
  return out;
}

export function judgeOrder(order: CandidateOrder, parcels: OpenParcel[]): OrderVerdict {
  const codCents = sum(parcels, "codCents");
  const feeCents = sum(parcels, "feeCents");
  const city = cityOf(parcels, order);
  const reasons: string[] = [];
  const confidenceNotes: string[] = [];
  const evidence = matchEvidence(order, parcels, codCents, city);
  const base = {
    evidence,
    preselect: false,
    order,
    parcels,
    codCents,
    feeCents,
    city,
    reasons,
    confidenceNotes,
    missingCents: 0,
    willSetDelivered: false,
    willSetCost: false,
    costConflict: false,
  };

  const notDelivered = parcels.filter((p) => p.status !== "delivered");
  if (notDelivered.length > 0) {
    for (const p of notDelivered)
      reasons.push(`الكرطونة ${p.trackingCode} حالتها «${p.statusRaw ?? p.status}» — ماشي «Livré».`);
    return { ...base, kind: "blocked", confidence: "medium" };
  }

  if (order.finalTotalCents === null) {
    reasons.push("الطلبية ما عندهاش مبلغ نهائي فالموقع.");
    return { ...base, kind: "blocked", confidence: "medium" };
  }

  const finalTotal = order.finalTotalCents;
  if (codCents > finalTotal) {
    reasons.push(
      `المحصَّل ${mad(codCents)} كيفوت المبلغ النهائي ${mad(finalTotal)} بـ${mad(codCents - finalTotal)}.`
    );
    return { ...base, kind: "blocked", confidence: "medium" };
  }

  const count = parcels.length;
  const known = order.cartonCount;
  if (codCents < finalTotal) {
    if (known !== null && count >= known) {
      reasons.push(
        `وصلات ${count} من ${known} كرطونات المسجلة ولكن ناقص ${mad(finalTotal - codCents)} — المبلغ ما متطابقش.`
      );
      return { ...base, kind: "blocked", confidence: "medium" };
    }
    reasons.push(`ناقص ${mad(finalTotal - codCents)} — كتسنى الكرطونات الباقية ففاتورة جاية.`);
    return { ...base, kind: "waiting", confidence: "medium", missingCents: finalTotal - codCents };
  }

  // المجموع = المبلغ النهائي بالضبط.
  if (known !== null && count < known) {
    reasons.push(
      `المبلغ كامل ولكن وصلات ${count} من ${known} كرطونات المسجلة — كتسنى كرطونة بلا تحصيل.`
    );
    return { ...base, kind: "waiting", confidence: "medium" };
  }
  if (known !== null && count > known) {
    reasons.push(`وصلات ${count} كرطونات والمسجل فالطلبية ${known}.`);
    return { ...base, kind: "blocked", confidence: "medium" };
  }

  if (order.status === "cancelled" || order.status === "returned") {
    reasons.push(`الطلبية «${STATUS_LABELS[order.status]}» فالموقع والشركة كتقول تسلّمات — صحّحها بيدك.`);
    return { ...base, kind: "blocked", confidence: "medium" };
  }
  if (!AUTO_STATUSES.has(order.status) && !DECIDE_STATUSES.has(order.status)) {
    reasons.push(
      `الطلبية مازال «${STATUS_LABELS[order.status] ?? order.status}» فالموقع (ما تأكداتش) — أكّدها بيدك أولاً.`
    );
    return { ...base, kind: "blocked", confidence: "medium" };
  }

  if (DECIDE_STATUSES.has(order.status))
    reasons.push(
      `الحالة فالموقع «${STATUS_LABELS[order.status]}» ماشي «مُرسَلة» — واش نعتبرها مسلّمة؟`
    );
  if (city === "differ")
    reasons.push(`المدينة مختلفة: الفاتورة «${parcels[0].city}» والطلبية «${order.city}».`);

  const costConflict =
    order.actualDeliveryCostCents !== null && order.actualDeliveryCostCents !== feeCents;
  if (costConflict)
    reasons.push(
      `تكلفة التوصيل المسجلة بيدك ${mad(order.actualDeliveryCostCents!)} والفاتورة ${mad(feeCents)} — كتبقى ديالك حتى توافق.`
    );

  if (known === null)
    confidenceNotes.push(
      "عدد الكرطونات ما مسجلش فالطلبية: ممكن تكون كرطونة بلا تحصيل مازال ما وصلاتش. سجّل العدد فصفحة الطلبية باش تولي الثقة عالية، ولا اختارها بيدك إلا كنتي متأكد."
    );
  if (city === "unknown") confidenceNotes.push("المدينة ما قدرتش تتقارن.");
  const confidence: Confidence = known !== null && city === "match" ? "high" : "medium";

  const kind: OrderVerdictKind = reasons.length > 0 ? "decide" : "ready";
  return {
    ...base,
    kind,
    confidence,
    preselect: kind === "ready" && confidence === "high",
    willSetDelivered: order.status !== "delivered",
    willSetCost: order.actualDeliveryCostCents === null || costConflict,
    costConflict,
  };
}

export function matchParcels(
  openParcels: OpenParcel[],
  candidateOrders: CandidateOrder[]
): MatchingResult {
  const orders: OrderVerdict[] = [];
  const parcelGroups: ParcelGroupVerdict[] = [];

  const byPhone = new Map<string, OpenParcel[]>();
  const noPhone: OpenParcel[] = [];
  for (const p of openParcels) {
    if (!p.phoneKey) noPhone.push(p);
    else byPhone.set(p.phoneKey, [...(byPhone.get(p.phoneKey) ?? []), p]);
  }
  if (noPhone.length > 0)
    parcelGroups.push({ kind: "unmatched", parcels: noPhone, candidates: [], reason: "بلا هاتف مقروء." });

  for (const [key, group] of byPhone) {
    const all = candidateOrders.filter((o) => o.phoneKey === key);
    let open = all.filter((o) => !o.settled);
    let remaining = [...group];

    // نوزّع ما دام هناك تقدّم: كل جولة تحسم طلبية واحدة بيقين.
    let progressed = true;
    while (progressed && remaining.length > 0 && open.length > 0) {
      progressed = false;

      if (open.length === 1) {
        const order = open[0];
        const fits = remaining.filter((p) => parcelFitsOrder(p, order));
        if (fits.length > 0) {
          orders.push(judgeOrder(order, fits));
          remaining = remaining.filter((p) => !fits.includes(p));
          open = [];
          progressed = true;
        }
        break;
      }

      if (remaining.length > MAX_SUBSET_PARCELS) break;
      const hits: { order: CandidateOrder; subset: OpenParcel[] }[] = [];
      let ambiguousSubset = false;
      for (const order of open) {
        if (order.finalTotalCents === null) continue;
        const fits = remaining.filter((p) => parcelFitsOrder(p, order));
        const subsets = exactSubsets(fits, order.finalTotalCents);
        if (subsets.length === 1) hits.push({ order, subset: subsets[0] });
        else if (subsets.length > 1) ambiguousSubset = true;
      }
      if (hits.length === 1 && !ambiguousSubset) {
        const { order, subset } = hits[0];
        orders.push(judgeOrder(order, subset));
        remaining = remaining.filter((p) => !subset.includes(p));
        open = open.filter((o) => o !== order);
        progressed = true;
      }
    }

    if (remaining.length === 0) continue;
    if (open.length > 1) {
      parcelGroups.push({
        kind: "ambiguous",
        parcels: remaining,
        candidates: open,
        reason: `${open.length} طلبيات مفتوحة بنفس الهاتف والمبالغ ما كتفرّقش بيناتهم — اختار بيدك.`,
      });
    } else if (all.some((o) => o.settled)) {
      parcelGroups.push({
        kind: "extra",
        parcels: remaining,
        candidates: all.filter((o) => o.settled),
        reason: "الهاتف ديال طلبية سبق تسويتها — كرطونة زايدة أو طلبية جديدة ما مسجلاش.",
      });
    } else {
      parcelGroups.push({
        kind: "unmatched",
        parcels: remaining,
        candidates: open,
        reason:
          open.length === 1
            ? "تاريخ الاستلام خارج مدة الطلبية الوحيدة بهاد الهاتف."
            : "ما كاينة حتى طلبية بهاد الهاتف.",
      });
    }
  }

  return { orders, parcelGroups };
}
