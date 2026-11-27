import { sql } from "@/lib/db";
import { expenseCategoryLabel } from "@/lib/expenses/expenseCategories";
import { computeOrderProfit } from "@/lib/orders/orderProfit";
import { dbMoneyToCents, type Cents } from "./money";
import { loadProfitLines } from "./settlementStore";

/**
 * الوضع المالي الحقيقي — من الفواتير والبنك وحدهما.
 *
 * ## القاعدة الوحيدة: لا رقم مقدَّر يدخل «الربح المحقَّق»
 *
 * الطلبية تدخل الربح المحقَّق إذا تحققت فيها ثلاثة شروط معاً:
 *   1. تسوية فعّالة «delivered» من فاتورة شركة التوصيل (المبلغ تحصّل فعلاً).
 *   2. تكلفة التوصيل من الفاتورة نفسها (لا تقدير، لا إدخال يدوي).
 *   3. ثمن شراء كل سطر محفوظ لحظة الطلب (purchase_price_snapshot).
 * طلبية ينقصها أحد الشروط تُعَدّ وتُعرَض على حدة، ولا تدخل أي مجموع.
 *
 * ## الأشهر
 *
 * - الربح والرجعات: بتاريخ **فاتورة** الشركة التي اكتملت بها التسوية (يوم
 *   حسبات الشركة الفلوس). فاتورة بلا تاريخ مقروء ← يوم رفعها.
 * - البنك: بتاريخ الوصول الذي أدخله المالك.
 * - المصاريف: بتاريخ وقوعها (spent_on) كما في صفحة المصاريف.
 * المغرب على UTC+0 منذ شتنبر 2026، فالحدود أيام UTC.
 *
 * ## ما ليس هنا عمداً
 *
 * - «عند شركات التوصيل» رصيد اليوم لا رقم شهر: كل فاتورة فعّالة لم يُسجَّل
 *   وصول فلوسها، مهما كان شهرها.
 * - «مُرسَلة بلا فاتورة» ليست فلوساً: قد ترجع. تُعرَض عدداً ومبلغاً متوقَّعاً
 *   بعنوان صريح، ولا تُجمَع مع شيء.
 */

export type Period = { key: string; label: string; from: string | null; to: string | null };

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "ماي", "يونيو",
  "يوليوز", "غشت", "شتنبر", "أكتوبر", "نونبر", "دجنبر",
];

/** «2026-11» ← نونبر 2026 من 1 إلى 1 دجنبر؛ «all» ← بلا حدود. أي قيمة أخرى ← الشهر الحالي. */
export function resolvePeriod(raw: string | null | undefined, today = new Date()): Period {
  if (raw === "all") return { key: "all", label: "منذ البداية", from: null, to: null };
  const m = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth() + 1;
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    year = Number(m[1]);
    month = Number(m[2]);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return {
    key: `${year}-${pad(month)}`,
    label: `${MONTHS_AR[month - 1]} ${year}`,
    from: `${year}-${pad(month)}-01`,
    to: `${next.y}-${pad(next.m)}-01`,
  };
}

export function shiftPeriodKey(key: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export type RealizedOrder = {
  orderId: number;
  orderNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  collectedCents: Cents;
  salesCents: Cents;
  cogsCents: Cents;
  deliveryChargedCents: Cents;
  deliveryRealCents: Cents;
  profitCents: Cents;
  /** كل فواتير كرطوناتها سُجّل وصول فلوسها للبنك. */
  banked: boolean;
};

export type ExcludedOrder = { orderId: number; orderNumber: string; reason: string };

export type ReturnLoss = {
  orderId: number | null;
  orderNumber: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  parcelCount: number;
  lossCents: Cents;
  statusChanged: boolean;
};

export type FinanceSummary = {
  period: Period;
  cash: {
    /** وصلات للبنك فهاد المدة — كما أدخلها المالك. */
    bankReceivedCents: Cents;
    bankReceivedInvoices: number;
    /** رصيد اليوم: فواتير فعّالة ما وصلاتش فلوسها. */
    owedCents: Cents;
    /** carrierStatus: ما كتبتو الشركة («Payé»…) — للعرض فقط، ماشي دليل على وصول الفلوس. */
    owedInvoices: { id: number; number: string; carrierLabel: string; date: string | null; netCents: Cents; carrierStatus: string | null }[];
    /** فواتير وصلات فلوسها بمبلغ مختلف عن الصافي. */
    bankDifferences: { id: number; number: string; netCents: Cents; receivedCents: Cents }[];
    /** مُرسَلة بلا فاتورة — متوقَّع لا محقَّق. */
    shippedNoInvoice: { count: number; expectedCents: Cents; oldestOrderDay: string | null };
  };
  realized: {
    orders: RealizedOrder[];
    collectedCents: Cents;
    salesCents: Cents;
    cogsCents: Cents;
    deliveryChargedCents: Cents;
    deliveryRealCents: Cents;
    profitCents: Cents;
    /** ربح طلبيات وصلات فلوسها للبنك. */
    bankedProfitCents: Cents;
    /** ربح طلبيات مسلّمة بفاتورة، وفلوسها مازال عند شركة التوصيل. */
    pendingProfitCents: Cents;
    excluded: ExcludedOrder[];
  };
  returns: { items: ReturnLoss[]; lossCents: Cents };
  expenses: { totalCents: Cents; advertisingCents: Cents; byCategory: { category: string; label: string; cents: Cents }[] };
  /** الربح المحقَّق − خسائر الرجعات − المصاريف المسجلة. */
  netCents: Cents;
  /** طلبيات معلَّمة «مسلَّمة» بلا فاتورة توصيل (كل الأوقات) — ربحها ما داخلش. */
  deliveredWithoutInvoice: number;
};

const CARRIER_LABEL: Record<string, string> = { bigdelivery: "BigDelivery", ozonexpress: "OzonExpress" };

const cents = (v: string | number | null) => dbMoneyToCents(v) ?? 0;
const madToCents = (v: number) => Math.round(v * 100);

/**
 * ملاحظة تنفيذية دفعنا ثمنها مرتين (هنا وفي adminReports.ts): شظية sql تحمل
 * معاملات، مركَّبة داخل استعلام آخر، كتعلّق على مجمّع اتصالات Supabase في
 * Preview (الاستعلام يبقى «active/ClientRead» حتى ينقطع الاتصال). لذلك شرط
 * المدة مكتوب داخل كل استعلام بمعاملين صريحين، والمدة المفتوحة = null، بلا
 * أي شظية بمعاملات.
 */
export async function getFinanceSummary(period: Period): Promise<FinanceSummary> {
  const from = period.from;
  const to = period.to;

  // بالتسلسل لا بالتوازي، عمداً: مجمّع الاتصالات 5، والتخطيط (شارة الطلبيات
  // الجديدة) يأخذ واحداً. سبعة استعلامات متوازية كانت تُركَّب خلف بعضها على
  // اتصال مشغول، فيعلق أحدها على مجمّع Supabase («active/ClientRead») حتى
  // يُقطع الاتصال وتسقط الصفحة. استعلامات صغيرة في نفس المنطقة: التسلسل أسلم.
  const bank = await sql<{ total: string | null; n: number }[]>`
    select coalesce(sum(i.bank_received_amount), 0) as total, count(*)::int as n
    from public.carrier_invoices i
    where i.status = 'active' and i.bank_received_at is not null
      and (${from}::date is null or (i.bank_received_at at time zone 'UTC')::date >= ${from}::date)
      and (${to}::date is null or (i.bank_received_at at time zone 'UTC')::date < ${to}::date)
  `;
  const owed = await sql<{ id: number; invoice_number: string; carrier: string; invoice_date: string | null; total_net: string; carrier_status: string | null }[]>`
    select i.id, i.invoice_number, i.carrier, i.invoice_date::text as invoice_date, i.total_net, i.carrier_status
    from public.carrier_invoices i
    where i.status = 'active' and i.bank_received_at is null
    order by coalesce(i.invoice_date, i.uploaded_at::date), i.id
  `;
  const differences = await sql<{ id: number; invoice_number: string; total_net: string; bank_received_amount: string }[]>`
    select i.id, i.invoice_number, i.total_net, i.bank_received_amount
    from public.carrier_invoices i
    where i.status = 'active' and i.bank_received_at is not null
      and i.bank_received_amount <> i.total_net
      and not (i.total_net < 0 and i.bank_received_amount = 0)
    order by i.id
  `;
  const shipped = await sql<{ n: number; expected: string | null; oldest: string | null }[]>`
    select count(*)::int as n, coalesce(sum(o.final_total), 0) as expected,
      min(o.created_at at time zone 'UTC')::date::text as oldest
    from public.orders o
    where o.status = 'shipped'
      and not exists (
        select 1 from public.carrier_order_settlements s
        where s.order_id = o.id and s.reverted_at is null
      )
  `;
  const settled = await sql<
    {
      order_id: number | null;
      order_number: string | null;
      order_status: string | null;
      delivery_fee: string | null;
      final_total: string | null;
      outcome: "delivered" | "returned";
      cod_total: string;
      fee_total: string;
      parcel_count: number;
      invoice_number: string;
      invoice_day: string;
      banked: boolean;
    }[]
  >`
    select s.order_id, o.order_number, o.status as order_status, o.delivery_fee, o.final_total,
      s.outcome, s.cod_total, s.fee_total, s.parcel_count,
      i.invoice_number, x.day::text as invoice_day,
      -- طلبية كرطوناتها فعدة فواتير: فلوسها «وصلات» غير إلا وصلات كل فاتورة.
      coalesce((
        select bool_and(pi.bank_received_at is not null)
        from public.carrier_parcels pp
        join public.carrier_invoices pi on pi.id = pp.invoice_id
        where pp.id = any(s.parcel_ids)
      ), false) as banked
    from public.carrier_order_settlements s
    join public.carrier_invoices i on i.id = s.invoice_id
    cross join lateral (
      select coalesce(i.invoice_date, (i.uploaded_at at time zone 'UTC')::date) as day
    ) x
    left join public.orders o on o.id = s.order_id
    where s.reverted_at is null
      and (${from}::date is null or x.day >= ${from}::date)
      and (${to}::date is null or x.day < ${to}::date)
    order by x.day, s.id
  `;
  const expenses = await sql<{ category: string; total: string }[]>`
    select category, coalesce(sum(amount_mad), 0) as total
    from public.operating_expenses
    where (${from}::date is null or spent_on >= ${from}::date)
      and (${to}::date is null or spent_on < ${to}::date)
    group by category
    order by sum(amount_mad) desc
  `;
  const deliveredRows = await sql<{ n: number }[]>`
    select count(*)::int as n from public.orders o
    where o.status = 'delivered'
      and not exists (
        select 1 from public.carrier_order_settlements s
        where s.order_id = o.id and s.reverted_at is null
      )
  `;
  const deliveredWithoutInvoice = deliveredRows[0]?.n ?? 0;

  const delivered = settled.filter((s) => s.outcome === "delivered");
  const lines = await loadProfitLines(
    delivered.map((s) => s.order_id).filter((id): id is number => id !== null).map(Number)
  );

  const realizedOrders: RealizedOrder[] = [];
  const excluded: ExcludedOrder[] = [];
  for (const s of delivered) {
    if (s.order_id === null || s.order_number === null) {
      excluded.push({ orderId: 0, orderNumber: "—", reason: "الطلبية تحذفات من بعد التسوية." });
      continue;
    }
    const orderId = Number(s.order_id);
    if (s.order_status !== "delivered") {
      excluded.push({
        orderId,
        orderNumber: s.order_number,
        reason: `حالتها تبدلات من بعد التسوية لـ«${s.order_status}» — راجعها.`,
      });
      continue;
    }
    const p = computeOrderProfit({
      status: "delivered",
      lines: (lines.get(orderId) ?? []).map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unit_price_snapshot,
        purchasePriceSnapshot: l.purchase_price_snapshot,
        currentPurchasePrice: l.current_purchase_price,
        lineStatus: l.line_status,
      })),
      deliveryFee: s.delivery_fee,
      actualDeliveryCost: s.fee_total,
    });
    if (p.netProfitMad === null || p.cogsMad === null) {
      excluded.push({ orderId, orderNumber: s.order_number, reason: "ناقصها ثمن الشراء ديال شي منتج." });
      continue;
    }
    if (p.isEstimate) {
      excluded.push({
        orderId,
        orderNumber: s.order_number,
        reason: "ثمن الشراء ماشي محفوظ من نهار الطلبية (غير تقدير بثمن اليوم).",
      });
      continue;
    }
    realizedOrders.push({
      orderId,
      orderNumber: s.order_number,
      invoiceNumber: s.invoice_number,
      invoiceDate: s.invoice_day,
      collectedCents: cents(s.cod_total),
      salesCents: madToCents(p.salesMad),
      cogsCents: madToCents(p.cogsMad),
      deliveryChargedCents: madToCents(p.deliveryCollectedMad),
      deliveryRealCents: cents(s.fee_total),
      // الربح على اللي تحصّل فعلاً: فرق التقريب (853 + 853 لطلبية 1,705) فلوس حقيقية.
      profitCents:
        madToCents(p.netProfitMad) +
        (s.final_total === null ? 0 : cents(s.cod_total) - cents(s.final_total)),
      banked: s.banked === true,
    });
  }

  const sumOf = (key: keyof RealizedOrder) =>
    realizedOrders.reduce((acc, o) => acc + (o[key] as number), 0);

  const returnItems: ReturnLoss[] = settled
    .filter((s) => s.outcome === "returned")
    .map((s) => ({
      orderId: s.order_id === null ? null : Number(s.order_id),
      orderNumber: s.order_number,
      invoiceNumber: s.invoice_number,
      invoiceDate: s.invoice_day,
      parcelCount: s.parcel_count,
      lossCents: cents(s.fee_total),
      statusChanged: s.order_status === "returned" || s.order_status === "cancelled",
    }));
  const returnLoss = returnItems.reduce((acc, r) => acc + r.lossCents, 0);

  const byCategory = expenses.map((e) => ({
    category: e.category,
    label: expenseCategoryLabel(e.category),
    cents: cents(e.total),
  }));
  const expensesTotal = byCategory.reduce((acc, e) => acc + e.cents, 0);
  const profit = sumOf("profitCents");

  return {
    period,
    cash: {
      bankReceivedCents: cents(bank[0]?.total ?? 0),
      bankReceivedInvoices: bank[0]?.n ?? 0,
      owedCents: owed.reduce((acc, i) => acc + cents(i.total_net), 0),
      owedInvoices: owed.map((i) => ({
        id: Number(i.id),
        number: i.invoice_number,
        carrierLabel: CARRIER_LABEL[i.carrier] ?? i.carrier,
        date: i.invoice_date,
        netCents: cents(i.total_net),
        carrierStatus: i.carrier_status,
      })),
      bankDifferences: differences.map((d) => ({
        id: Number(d.id),
        number: d.invoice_number,
        netCents: cents(d.total_net),
        receivedCents: cents(d.bank_received_amount),
      })),
      shippedNoInvoice: {
        count: shipped[0]?.n ?? 0,
        expectedCents: cents(shipped[0]?.expected ?? 0),
        oldestOrderDay: shipped[0]?.oldest ?? null,
      },
    },
    realized: {
      orders: realizedOrders,
      collectedCents: sumOf("collectedCents"),
      salesCents: sumOf("salesCents"),
      cogsCents: sumOf("cogsCents"),
      deliveryChargedCents: sumOf("deliveryChargedCents"),
      deliveryRealCents: sumOf("deliveryRealCents"),
      profitCents: profit,
      bankedProfitCents: realizedOrders.filter((o) => o.banked).reduce((acc, o) => acc + o.profitCents, 0),
      pendingProfitCents: realizedOrders.filter((o) => !o.banked).reduce((acc, o) => acc + o.profitCents, 0),
      excluded,
    },
    returns: { items: returnItems, lossCents: returnLoss },
    expenses: {
      totalCents: expensesTotal,
      advertisingCents: byCategory.find((e) => e.category === "advertising")?.cents ?? 0,
      byCategory,
    },
    netCents: profit - returnLoss - expensesTotal,
    deliveredWithoutInvoice,
  };
}
