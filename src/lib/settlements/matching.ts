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
 * - كرطونة مرجوعة أو مرفوضة لا تُطبَّق تلقائياً أبداً. حين ترجع **كل** كرطونات
 *   الطلبية تصير «رجعة» (return): تُعرَض على المالك ليؤكّدها، فتُسجَّل رسومها
 *   خسارةً حقيقية على الطلبية، **دون** تغيير حالتها («returned» في الموقع يُرجع
 *   المخزون، فلا يقرّره إلا المالك من صفحة الطلبية ملي توصلو السلعة).
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
  /** ربط يدوي من المالك بطلبية بعينها (يتجاوز البحث بالهاتف، ولا يُطبَّق إلا بموافقة). */
  manualOrderId?: number | null;
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
 * return   كل كرطوناتها رجعات/ترفضات: تُسجَّل رسومها خسارةً بتأكيد المالك وحده
 *          (لا تُعلَّم مسبقاً أبداً، ولا تمرّ بالموافقة الجماعية).
 */
export type OrderVerdictKind = "ready" | "decide" | "blocked" | "waiting" | "return";

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
  /** المالك ربط الكرطونات بهاد الطلبية بيدو: ما تُطبَّق إلا بموافقة صريحة. */
  manual: boolean;
  /** كرطونة من كشف فيه فرق فالمجاميع ما وافقش عليه المالك: ما تُطبَّق حتى يوافق. */
  invoiceWarningPending?: boolean;
  /** فرق التقريب بين المحصَّل والمبلغ النهائي (بالسنتيم، موجب = تحصّل أكثر). 0 = بالضبط. */
  roundingCents: number;
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
/**
 * الحالات التي تقبل تسجيل رجعة: خرجت السلعة فعلاً مع شركة التوصيل (أو سبق
 * للمالك أن علّمها راجعة/ملغاة). «جديدة» أو «تحتاج مراجعة» لم تُؤكَّد أصلاً،
 * و«مسلَّمة» تناقض الفاتورة — كلاهما يُصحَّح باليد.
 */
const RETURN_STATUSES = new Set(["shipped", "confirmed", "preparing", "returned", "cancelled"]);
const RETURNED_PARCEL = new Set(["returned", "refused"]);

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
/**
 * تسجيل متأخر: طلبية دخلات للموقع من بعد ما خرجات الكرطونة (طلب واتساب تسجّل
 * من بعد). ما تُرشَّح إلا إلا ما كانت حتى طلبية قبل الإرسال، وما كتطبق إلا بموافقة.
 */
const LATE_REGISTRATION_DAYS = 3;
/**
 * فرق التقريب المقبول (بقرار المالك وحده، أبداً تلقائياً): درهم واحد لكل كرطونة،
 * وماشي أكثر من 5 دراهم. مثال حقيقي: 1,705 مقسومة على جوج كرطونات = 853 + 853.
 */
const ROUNDING_CENTS_PER_PARCEL = 100;
const MAX_ROUNDING_CENTS = 500;
/** حالات خرجت فيها السلعة فعلاً (أو تقريباً): لها الأولوية على ملغاة/جديدة بنفس المبلغ. */
const SENT_LIKE = new Set(["shipped", "delivered", "confirmed", "preparing"]);

export function roundingTolerance(parcelCount: number): number {
  return Math.min(parcelCount * ROUNDING_CENTS_PER_PARCEL, MAX_ROUNDING_CENTS);
}
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

export type JudgeOptions = {
  /** ربط يدوي من المالك. */
  manual?: boolean;
  /** الطلبية تسجّلات من بعد الإرسال بهاد عدد الأيام. */
  lateDays?: number;
};

export function judgeOrder(order: CandidateOrder, parcels: OpenParcel[], opts: JudgeOptions = {}): OrderVerdict {
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
    manual: opts.manual === true,
    roundingCents: 0,
    willSetDelivered: false,
    willSetCost: false,
    costConflict: false,
  };

  const notDelivered = parcels.filter((p) => p.status !== "delivered");
  if (notDelivered.length > 0 && notDelivered.length === parcels.length && parcels.every((p) => RETURNED_PARCEL.has(p.status))) {
    return judgeReturn(base, order, parcels, codCents, feeCents);
  }
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
  const count = parcels.length;
  const known = order.cartonCount;
  const tolerance = roundingTolerance(count);
  let roundingCents = 0;
  if (codCents > finalTotal) {
    if (codCents - finalTotal > tolerance) {
      reasons.push(
        `المحصَّل ${mad(codCents)} كيفوت المبلغ النهائي ${mad(finalTotal)} بـ${mad(codCents - finalTotal)}.`
      );
      return { ...base, kind: "blocked", confidence: "medium" };
    }
    roundingCents = codCents - finalTotal;
  } else if (
    codCents < finalTotal &&
    finalTotal - codCents <= tolerance &&
    !(known !== null && count < known)
  ) {
    // ناقص درهم ولا جوج: ماشي كرطونة ناقصة (حتى كرطونة ما كتساوي درهم)، تقريب فالتحصيل.
    roundingCents = codCents - finalTotal;
  }

  if (roundingCents === 0 && codCents < finalTotal) {
    if (known !== null && count >= known) {
      reasons.push(
        `وصلات ${count} من ${known} كرطونات المسجلة ولكن ناقص ${mad(finalTotal - codCents)} — المبلغ ما متطابقش.`
      );
      return { ...base, kind: "blocked", confidence: "medium" };
    }
    reasons.push(`ناقص ${mad(finalTotal - codCents)} — كتسنى الكرطونات الباقية ففاتورة جاية.`);
    return { ...base, kind: "waiting", confidence: "medium", missingCents: finalTotal - codCents };
  }

  // المجموع = المبلغ النهائي بالضبط (أو بفرق تقريب صغير، كيتعرض على المالك).
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

  if (roundingCents !== 0)
    reasons.push(
      roundingCents > 0
        ? `الشركة حصّلات ${mad(codCents)} والطلبية ${mad(finalTotal)}: زايد ${mad(roundingCents)} — تقريب ملي تقسم المبلغ على ${count} كرطونات؟ الربح كيتحسب على اللي تحصّل فعلاً.`
        : `الشركة حصّلات ${mad(codCents)} والطلبية ${mad(finalTotal)}: ناقص ${mad(-roundingCents)} — تقريب فالتحصيل؟ الربح كيتحسب على اللي تحصّل فعلاً.`
    );
  if (opts.manual)
    reasons.push("ربطتيها بيدك بهاد الطلبية — تأكد من الأدلة قبل ما تطبّق.");
  if (opts.lateDays !== undefined)
    reasons.push(
      `الطلبية تسجّلات فالموقع من بعد ما خرجات الكرطونة بـ${opts.lateDays} يوم — تسجيل متأخر؟ ما كاينة حتى طلبية قبل الإرسال بهاد الهاتف.`
    );
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
    roundingCents,
    kind,
    confidence,
    preselect: kind === "ready" && confidence === "high",
    willSetDelivered: order.status !== "delivered",
    willSetCost: order.actualDeliveryCostCents === null || costConflict,
    costConflict,
  };
}

/** كل كرطونات الطلبية رجعات: خسارة الرسوم تُسجَّل بتأكيد المالك، والحالة لا تُمسّ. */
function judgeReturn(
  base: Omit<OrderVerdict, "kind" | "confidence">,
  order: CandidateOrder,
  parcels: OpenParcel[],
  codCents: Cents,
  feeCents: Cents
): OrderVerdict {
  const reasons = base.reasons;
  if (codCents !== 0) {
    const raw = [...new Set(parcels.map((p) => p.statusRaw ?? p.status))].join("/");
    reasons.push(`الكرطونات «${raw}» وفيها تحصيل ${mad(codCents)} — هادشي ماشي عادي، صحّحها بيدك.`);
    return { ...base, kind: "blocked", confidence: "medium" };
  }
  if (!RETURN_STATUSES.has(order.status)) {
    reasons.push(
      order.status === "delivered"
        ? "الطلبية «مسلَّمة» فالموقع والشركة كتقول رجعات — صحّحها بيدك."
        : `الطلبية مازال «${STATUS_LABELS[order.status] ?? order.status}» فالموقع — صحّحها بيدك.`
    );
    return { ...base, kind: "blocked", confidence: "medium" };
  }
  const costConflict =
    order.actualDeliveryCostCents !== null && order.actualDeliveryCostCents !== feeCents;
  if (costConflict)
    reasons.push(
      `تكلفة التوصيل المسجلة بيدك ${mad(order.actualDeliveryCostCents!)} والفاتورة ${mad(feeCents)} — إلا أكدتي كتولي ديال الفاتورة.`
    );
  return {
    ...base,
    kind: "return",
    confidence: "medium",
    preselect: false,
    willSetDelivered: false,
    willSetCost: order.actualDeliveryCostCents === null || costConflict,
    costConflict,
  };
}

/** المجموعات الجزئية اللي مجموعها قريب من الهدف بفرق تقريب (ماشي بالضبط). */
function nearSubsets(parcels: OpenParcel[], target: Cents): OpenParcel[][] {
  const out: OpenParcel[][] = [];
  const n = parcels.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    let size = 0;
    for (let i = 0; i < n; i++)
      if (mask & (1 << i)) {
        s += parcels[i].codCents;
        size++;
      }
    if (s !== target && Math.abs(s - target) <= roundingTolerance(size))
      out.push(parcels.filter((_, i) => mask & (1 << i)));
  }
  return out;
}

export function matchParcels(
  openParcels: OpenParcel[],
  candidateOrders: CandidateOrder[]
): MatchingResult {
  const orders: OrderVerdict[] = [];
  const parcelGroups: ParcelGroupVerdict[] = [];

  // 0) الربط اليدوي من المالك: كيتجاوز البحث بالهاتف، والحكم كيبقى نفس الحكم
  //    (المبلغ، الحالة، الكرطونات)، ودايماً «تحتاج قرارك».
  const pinned = new Map<number, OpenParcel[]>();
  const free: OpenParcel[] = [];
  for (const p of openParcels) {
    if (p.manualOrderId) pinned.set(p.manualOrderId, [...(pinned.get(p.manualOrderId) ?? []), p]);
    else free.push(p);
  }
  for (const [orderId, ps] of pinned) {
    const order = candidateOrders.find((o) => o.id === orderId);
    if (!order) {
      parcelGroups.push({ kind: "unmatched", parcels: ps, candidates: [], reason: "مربوطة بيدك بطلبية ما بقاتش موجودة — فك الربط." });
    } else if (order.settled) {
      parcelGroups.push({ kind: "extra", parcels: ps, candidates: [order], reason: "مربوطة بيدك بطلبية سبق تسويتها — فك الربط." });
    } else {
      orders.push(judgeOrder(order, ps, { manual: true }));
    }
  }

  const byPhone = new Map<string, OpenParcel[]>();
  const noPhone: OpenParcel[] = [];
  for (const p of free) {
    if (!p.phoneKey) noPhone.push(p);
    else byPhone.set(p.phoneKey, [...(byPhone.get(p.phoneKey) ?? []), p]);
  }
  if (noPhone.length > 0)
    parcelGroups.push({ kind: "unmatched", parcels: noPhone, candidates: [], reason: "بلا هاتف مقروء." });

  for (const [key, group] of byPhone) {
    // طلبية مربوطة يدوياً بكرطونات أخرى ما كتدخلش فالبحث بالهاتف.
    const all = candidateOrders.filter((o) => o.phoneKey === key && !pinned.has(o.id));

    // التسلسل الزمني: الطلبية كتكون قبل خروج الكرطونة (ولا نفس النهار)، وماشي
    // أقدم منها بأكثر من 45 يوم. طلبية تسجّلات من بعد ما خرجات الكرطونة ماشي
    // هي — حتى ما كتحسبش فالغموض (TF-2026-0516: 25 يوم من بعد الإرسال).
    const pickups = group.map((p) => p.pickupDate).filter((d): d is string => d !== null).map(dayNumber);
    const firstPickup = pickups.length > 0 ? Math.min(...pickups) : null;
    const lastPickup = pickups.length > 0 ? Math.max(...pickups) : null;
    const daysAfterPickup = (o: CandidateOrder) => (lastPickup === null ? 0 : dayNumber(o.createdAt) - lastPickup);
    const inTime = (o: CandidateOrder) =>
      lastPickup === null ||
      (daysAfterPickup(o) <= 0 && dayNumber(o.createdAt) >= (firstPickup as number) - PICKUP_WINDOW_DAYS);
    let open = all.filter((o) => !o.settled && inTime(o));
    const later = all.filter((o) => !o.settled && !inTime(o) && daysAfterPickup(o) > 0);
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
      const collect = (find: (ps: OpenParcel[], t: Cents) => OpenParcel[][]) => {
        const hits: { order: CandidateOrder; subset: OpenParcel[] }[] = [];
        let ambiguous = false;
        for (const order of open) {
          if (order.finalTotalCents === null) continue;
          const subsets = find(remaining.filter((p) => parcelFitsOrder(p, order)), order.finalTotalCents);
          if (subsets.length === 1) hits.push({ order, subset: subsets[0] });
          else if (subsets.length > 1) ambiguous = true;
        }
        return { hits, ambiguous };
      };
      // بالضبط أولاً؛ وإلا ما كاين حتى مبلغ مضبوط، فرق التقريب (كيتعرض على المالك).
      let { hits, ambiguous } = collect(exactSubsets);
      if (hits.length === 0 && !ambiguous) ({ hits, ambiguous } = collect(nearSubsets));
      // جوج طلبيات بنفس المبلغ وحدة منهم وحدها «خرجات» (مُرسَلة/مسلَّمة/مؤكَّدة):
      // الأخرى ملغاة ولا جديدة ما تأكداتش — الكرطونة ديال اللي خرجات.
      if (hits.length > 1 && !ambiguous) {
        const sent = hits.filter((h) => SENT_LIKE.has(h.order.status));
        if (sent.length === 1) hits = sent;
      }
      if (hits.length === 1 && !ambiguous) {
        const { order, subset } = hits[0];
        orders.push(judgeOrder(order, subset));
        remaining = remaining.filter((p) => !subset.includes(p));
        open = open.filter((o) => o !== order);
        progressed = true;
      }
    }

    // تسجيل متأخر: ما كاينة حتى طلبية قبل الإرسال، وكاينة وحدة تسجّلات من بعدو بأيام قليلة.
    if (remaining.length > 0 && open.length === 0 && !all.some((o) => o.settled)) {
      const late = later.filter((o) => daysAfterPickup(o) <= LATE_REGISTRATION_DAYS);
      if (late.length === 1) {
        orders.push(judgeOrder(late[0], remaining, { lateDays: daysAfterPickup(late[0]) }));
        remaining = [];
      }
    }

    if (remaining.length === 0) continue;
    const laterNote =
      later.length > 0
        ? ` (${later.map((o) => `${o.orderNumber} تسجّلات ${daysAfterPickup(o)} يوم من بعد الإرسال`).join("، ")} — ماشي هي.)`
        : "";
    if (open.length > 1) {
      parcelGroups.push({
        kind: "ambiguous",
        parcels: remaining,
        candidates: open,
        reason: `${open.length} طلبيات مفتوحة بنفس الهاتف والمبالغ ما كتفرّقش بيناتهم — اربطها بيدك.${laterNote}`,
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
            : later.length > 0
              ? `ما كاينة حتى طلبية قبل الإرسال بهاد الهاتف${laterNote}`
              : "ما كاينة حتى طلبية بهاد الهاتف — ممكن بيعة ما تسجلاتش فالموقع، ولا الزبون عطا هاتف آخر.",
      });
    }
  }

  return { orders, parcelGroups };
}
