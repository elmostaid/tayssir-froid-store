import type { Sql, TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import type { ParsedInvoice } from "./bigDeliveryInvoice";
import {
  matchParcels,
  type CandidateOrder,
  type MatchingResult,
  type OpenParcel,
  type OrderVerdict,
} from "./matching";
import { centsToDb, dbMoneyToCents, type Cents } from "./money";

/**
 * طبقة القاعدة لنظام التسويات.
 *
 * ## ثلاث قواعد تحكم كل دالة هنا
 *
 * 1. **لا Purchase إلى Meta.** التسليم يُكتب في `orders` مباشرة بـSQL، ولا يمرّ
 *    أبداً بـ`updateOrderStatus` ولا بـ`sendDeferredPurchase`. لا استيراد لأيّ
 *    منهما في هذا الملف، والاختبارات تتجسّس على المرسِل لتتأكد.
 * 2. **لا يُمسّ إلا عمودان موجودان:** `status` (shipped/confirmed/preparing →
 *    delivered فقط، لا ملغاة ولا راجعة، فلا حركة مخزون) و`actual_delivery_cost`.
 *    الرجعة المؤكَّدة تكتب التكلفة وحدها، ولا تلمس الحالة أبداً.
 *    لا أثمنة ولا سطور ولا مخزون. كل كتابة لها صفّ في سجل التغييرات.
 * 3. **عملية واحدة في كل لحظة.** رفع/تطبيق/تراجع كلها داخل معاملة تأخذ قفلاً
 *    استشارياً واحداً، فلا يتقاطع ضغطتان على «طبّق» أو تطبيق مع تراجع.
 */

type Db = TransactionSql<Record<string, unknown>> | Sql<Record<string, unknown>>;

const LOCK_SQL = (db: Db) => db`select pg_advisory_xact_lock(hashtext('carrier_settlements'))`;

const CARRIER_LABEL: Record<string, string> = { bigdelivery: "BigDelivery", ozonexpress: "OzonExpress" };

// ---------------------------------------------------------------------------
// تسجيل الفاتورة
// ---------------------------------------------------------------------------

export type RegisterInvoiceInput = {
  parsed: ParsedInvoice;
  bytes: Uint8Array;
  fileName: string | null;
  sha256: string;
  actor: string;
  /** ملاحظات القراءة (Ozon: «Total Colis» مختلف). كتتحفظ وكتحتاج موافقة قبل التطبيق. */
  warnings?: string[];
};

export type RegisterInvoiceResult =
  | { kind: "created" | "reactivated"; invoiceId: number; duplicates: number; conflicts: string[] }
  | { kind: "already_active"; invoiceId: number }
  | { kind: "number_conflict"; invoiceId: number };

/**
 * يسجّل الفاتورة وكرطوناتها. لا يغيّر أي طلبية — التسجيل حقائق الشركة فقط،
 * والتطبيق على الطلبيات قرارٌ منفصل بزرّ «طبّق».
 *
 * - نفس الملف (نفس البصمة) فعّالٌ أصلاً → لا شيء جديد، نعيد نفس الفاتورة.
 * - نفس الملف كان متراجَعاً عنه → يُعاد تفعيله (هذه طريقة «أعد التطبيق»).
 * - نفس رقم الفاتورة بملف مختلف → يُرفض: لا نعرف أيّهما الصحيح.
 * - كرطونة فعّالة أصلاً في فاتورة أخرى → تُحفظ للأثر ولا تُفعَّل: بنفس المبلغ
 *   «مكررة»، وبمبلغ مختلف «تعارض» يُعرض على المالك.
 */
export async function registerInvoice(input: RegisterInvoiceInput): Promise<RegisterInvoiceResult> {
  const { parsed, bytes, fileName, sha256, actor } = input;
  return sql.begin(async (trx) => {
    await LOCK_SQL(trx);

    const bySha = await trx<{ id: number; status: string }[]>`
      select id, status from public.carrier_invoices where file_sha256 = ${sha256}
    `;
    if (bySha.length > 0 && bySha[0].status === "active") {
      return { kind: "already_active" as const, invoiceId: bySha[0].id };
    }

    let invoiceId: number;
    let kind: "created" | "reactivated";
    if (bySha.length > 0) {
      invoiceId = bySha[0].id;
      kind = "reactivated";
      await trx`
        update public.carrier_invoices
        set status = 'active', rolled_back_at = null, rolled_back_by = null
        where id = ${invoiceId}
      `;
      await trx`update public.carrier_parcels set skip_reason = null where invoice_id = ${invoiceId}`;
    } else {
      const byNumber = await trx<{ id: number }[]>`
        select id from public.carrier_invoices
        where carrier = ${parsed.carrier} and invoice_number = ${parsed.invoiceNumber}
      `;
      if (byNumber.length > 0) return { kind: "number_conflict" as const, invoiceId: byNumber[0].id };

      const inserted = await trx<{ id: number }[]>`
        insert into public.carrier_invoices (
          carrier, invoice_number, invoice_date, carrier_status, file_sha256, file_name,
          parcel_count, total_cod, total_fees, other_fees, total_net, uploaded_by, parse_warnings
        ) values (
          ${parsed.carrier}, ${parsed.invoiceNumber}, ${parsed.invoiceDate}, ${parsed.carrierStatus},
          ${sha256}, ${fileName}, ${parsed.parcels.length},
          ${centsToDb(parsed.totalCodCents ?? 0)}, ${centsToDb(parsed.totalFeesCents ?? 0)},
          ${centsToDb(parsed.otherFeesCents)}, ${centsToDb(parsed.totalNetCents ?? 0)}, ${actor},
          ${input.warnings ?? []}
        ) returning id
      `;
      invoiceId = inserted[0].id;
      kind = "created";
      await trx`
        insert into public.carrier_invoice_files (invoice_id, content, size_bytes)
        values (${invoiceId}, ${Buffer.from(bytes)}, ${bytes.byteLength})
      `;
      for (const p of parsed.parcels) {
        await trx`
          insert into public.carrier_parcels (
            invoice_id, carrier, line_no, tracking_code, phone, phone_key, city,
            cod_amount, fee, carrier_status, carrier_status_raw, pickup_date, delivery_date
          ) values (
            ${invoiceId}, ${parsed.carrier}, ${p.lineNo}, ${p.trackingCode}, ${p.phone}, ${p.phoneKey},
            ${p.city || null}, ${centsToDb(p.codCents)}, ${centsToDb(p.feeCents)}, ${p.status},
            ${p.statusRaw || null}, ${p.pickupDate}, ${p.deliveryDate}
          )
        `;
      }
    }

    // تفعيل الكرطونات واحدة واحدة مع فحص التكرار عبر الفواتير.
    const parcels = await trx<
      { id: number; carrier: string; tracking_code: string; cod_amount: string; fee: string }[]
    >`
      select id, carrier, tracking_code, cod_amount, fee from public.carrier_parcels
      where invoice_id = ${invoiceId} order by line_no
    `;
    let duplicates = 0;
    const conflicts: string[] = [];
    for (const p of parcels) {
      const existing = await trx<{ cod_amount: string; fee: string; invoice_number: string }[]>`
        select cp.cod_amount, cp.fee, ci.invoice_number
        from public.carrier_parcels cp join public.carrier_invoices ci on ci.id = cp.invoice_id
        where cp.carrier = ${p.carrier} and cp.tracking_code = ${p.tracking_code} and cp.active
      `;
      if (existing.length === 0) {
        await trx`update public.carrier_parcels set active = true where id = ${p.id}`;
        continue;
      }
      const same =
        dbMoneyToCents(existing[0].cod_amount) === dbMoneyToCents(p.cod_amount) &&
        dbMoneyToCents(existing[0].fee) === dbMoneyToCents(p.fee);
      await trx`
        update public.carrier_parcels set skip_reason = ${same ? "duplicate" : "duplicate_conflict"}
        where id = ${p.id}
      `;
      if (same) duplicates++;
      else
        conflicts.push(
          `الكرطونة ${p.tracking_code} سبق احتسابها ففاتورة ${existing[0].invoice_number} بمبلغ آخر — ما تحسباتش هنا.`
        );
    }
    return { kind, invoiceId, duplicates, conflicts };
  });
}

// ---------------------------------------------------------------------------
// اللوحة: حساب المطابقة على كل المفتوح
// ---------------------------------------------------------------------------

async function loadOpenParcels(db: Db): Promise<OpenParcel[]> {
  const rows = await db<
    {
      id: number;
      invoice_id: number;
      invoice_number: string;
      tracking_code: string;
      phone_key: string | null;
      city: string | null;
      cod_amount: string;
      fee: string;
      carrier_status: OpenParcel["status"];
      carrier_status_raw: string | null;
      pickup_date: string | null;
      manual_order_id: number | null;
    }[]
  >`
    select p.id, p.invoice_id, i.invoice_number, p.tracking_code, p.phone_key, p.city,
      p.cod_amount, p.fee, p.carrier_status, p.carrier_status_raw, p.pickup_date::text as pickup_date,
      p.manual_order_id
    from public.carrier_parcels p
    join public.carrier_invoices i on i.id = p.invoice_id
    where p.active and p.settlement_id is null and i.status = 'active'
    order by p.invoice_id, p.line_no
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    invoiceId: Number(r.invoice_id),
    invoiceNumber: r.invoice_number,
    trackingCode: r.tracking_code,
    phoneKey: r.phone_key,
    city: r.city,
    codCents: dbMoneyToCents(r.cod_amount)!,
    feeCents: dbMoneyToCents(r.fee)!,
    status: r.carrier_status,
    statusRaw: r.carrier_status_raw,
    pickupDate: r.pickup_date,
    manualOrderId: r.manual_order_id === null ? null : Number(r.manual_order_id),
  }));
}

/** الأرقام العربية المشرقية والفارسية ← لاتينية، قبل أخذ آخر 9 أرقام (نفس phoneKey). */
const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const LATIN_DIGITS = "01234567890123456789";

async function loadCandidates(
  db: Db,
  phoneKeys: string[],
  lock: boolean,
  orderIds: number[] = []
): Promise<CandidateOrder[]> {
  if (phoneKeys.length === 0 && orderIds.length === 0) return [];
  type Row = {
    id: number;
    order_number: string;
    status: string;
    phone_key: string;
    customer_city: string | null;
    created_at: Date;
    final_total: string | null;
    delivery_fee: string | null;
    carton_count: number | null;
    actual_delivery_cost: string | null;
    settled: boolean;
  };
  const rows = lock
    ? await db<Row[]>`
        select o.id, o.order_number, o.status,
          right(regexp_replace(translate(o.customer_phone, ${EASTERN_DIGITS}, ${LATIN_DIGITS}), '\\D', '', 'g'), 9) as phone_key,
          o.customer_city, o.created_at, o.final_total, o.delivery_fee, o.carton_count,
          o.actual_delivery_cost,
          exists (select 1 from public.carrier_order_settlements s
                  where s.order_id = o.id and s.reverted_at is null) as settled
        from public.orders o
        where right(regexp_replace(translate(o.customer_phone, ${EASTERN_DIGITS}, ${LATIN_DIGITS}), '\\D', '', 'g'), 9) = any(${phoneKeys})
          or o.id = any(${orderIds})
        order by o.created_at, o.id
        for update of o
      `
    : await db<Row[]>`
        select o.id, o.order_number, o.status,
          right(regexp_replace(translate(o.customer_phone, ${EASTERN_DIGITS}, ${LATIN_DIGITS}), '\\D', '', 'g'), 9) as phone_key,
          o.customer_city, o.created_at, o.final_total, o.delivery_fee, o.carton_count,
          o.actual_delivery_cost,
          exists (select 1 from public.carrier_order_settlements s
                  where s.order_id = o.id and s.reverted_at is null) as settled
        from public.orders o
        where right(regexp_replace(translate(o.customer_phone, ${EASTERN_DIGITS}, ${LATIN_DIGITS}), '\\D', '', 'g'), 9) = any(${phoneKeys})
          or o.id = any(${orderIds})
        order by o.created_at, o.id
      `;
  return rows.map((r) => ({
    id: Number(r.id),
    orderNumber: r.order_number,
    status: r.status,
    phoneKey: r.phone_key,
    city: r.customer_city,
    createdAt: new Date(r.created_at).toISOString(),
    finalTotalCents: dbMoneyToCents(r.final_total),
    deliveryFeeCents: dbMoneyToCents(r.delivery_fee),
    cartonCount: r.carton_count,
    actualDeliveryCostCents: dbMoneyToCents(r.actual_delivery_cost),
    settled: r.settled,
  }));
}

export async function computeBoard(db: Db = sql, lock = false): Promise<MatchingResult> {
  const parcels = await loadOpenParcels(db);
  const keys = [...new Set(parcels.map((p) => p.phoneKey).filter((k): k is string => k !== null))];
  const pinnedIds = [...new Set(parcels.map((p) => p.manualOrderId).filter((id): id is number => !!id))];
  const candidates = await loadCandidates(db, keys, lock, pinnedIds);
  const result = matchParcels(parcels, candidates);

  // كشف فيه ملاحظة قراءة ما وافقش عليها المالك (فرق «Total Colis» ديال Ozon):
  // طلبياتو كتبان بأدلتها، ولكن ما تقدرش تطبّق حتى يوافق على الفرق من صفحة الكشف.
  const pending = await db<{ id: number; invoice_number: string }[]>`
    select id, invoice_number from public.carrier_invoices
    where status = 'active' and cardinality(parse_warnings) > 0 and warnings_acknowledged_at is null
  `;
  if (pending.length > 0) {
    const pendingIds = new Map(pending.map((r) => [Number(r.id), r.invoice_number]));
    for (const v of result.orders) {
      const held = [...new Set(v.parcels.filter((p) => pendingIds.has(p.invoiceId)).map((p) => pendingIds.get(p.invoiceId)!))];
      if (held.length === 0) continue;
      v.invoiceWarningPending = true;
      v.preselect = false;
      v.reasons.push(`الكشف ${held.join(" + ")} فيه فرق فالمجاميع ما وافقتيش عليه — شوفو ووافق عليه من صفحة الكشف قبل التطبيق.`);
      if (v.kind === "ready") v.kind = "decide";
    }
  }
  return result;
}

/** موافقة المالك على ملاحظات قراءة الكشف (مثلاً فرق «Total Colis»). */
export async function acknowledgeInvoiceWarnings(invoiceId: number, actor: string): Promise<boolean> {
  const r = await sql`
    update public.carrier_invoices
    set warnings_acknowledged_at = now(), warnings_acknowledged_by = ${actor}
    where id = ${invoiceId} and cardinality(parse_warnings) > 0 and warnings_acknowledged_at is null
  `;
  return r.count === 1;
}

// ---------------------------------------------------------------------------
// التطبيق
// ---------------------------------------------------------------------------

export type ApplyInput = {
  /** من «جاهزة» — الموافقة الجماعية. */
  readyOrderIds: number[];
  /** من «تحتاج قرارك» — كل واحدة وافق عليها المالك صراحةً. */
  approvedOrderIds: number[];
  /** من «رجعات» — تأكيد المالك أن الكرطونات رجعات، فتُسجَّل رسومها خسارة. */
  returnOrderIds?: number[];
  actor: string;
};

export type ApplyResult = {
  applied: {
    orderId: number;
    orderNumber: string;
    outcome: "delivered" | "returned";
    statusChanged: boolean;
    costSet: boolean;
  }[];
  skipped: { orderId: number; reason: string }[];
};

/**
 * يطبّق التسويات المختارة. **يُعيد الحساب داخل المعاملة** بعد قفل الطلبيات:
 * ما ظهر «جاهزاً» في الصفحة قبل دقيقة لا يُطبَّق إلا إن بقي جاهزاً الآن (لم
 * يُعدَّل مبلغه، ولم تُلغَ، ولم تُطبَّق من نافذة أخرى).
 */
export async function applySettlements(input: ApplyInput): Promise<ApplyResult> {
  const ready = new Set(input.readyOrderIds);
  const approved = new Set(input.approvedOrderIds);
  const returns = new Set(input.returnOrderIds ?? []);
  return sql.begin(async (trx) => {
    await LOCK_SQL(trx);
    const board = await computeBoard(trx, true);
    const applied: ApplyResult["applied"] = [];
    const handled = new Set<number>();

    for (const v of board.orders) {
      const id = v.order.id;
      // الرجعة لا تُقبل إلا من خانتها: «اختار الجميع» على الجاهزة لا يمكن أن يسجّل رجعة.
      const eligible =
        (v.kind === "ready" && (ready.has(id) || approved.has(id))) ||
        (v.kind === "decide" && approved.has(id)) ||
        (v.kind === "return" && returns.has(id));
      // فرق فمجاميع الكشف ما وافقش عليه المالك: ما كتطبّقش، حتى لو اختارها.
      if (!eligible || v.invoiceWarningPending) continue;
      handled.add(id);
      applied.push(await applyOne(trx, v, input.actor, v.kind === "ready" ? "auto" : "approved"));
    }

    const skipped = [...new Set([...ready, ...approved, ...returns])]
      .filter((id) => !handled.has(id))
      .map((id) => ({
        orderId: id,
        reason: "تبدلات حالتها من بعد ما عرضناها (أو سبق تطبيقها) — ما طبقناهاش.",
      }));
    return { applied, skipped };
  });
}

async function applyOne(
  trx: Db,
  v: OrderVerdict,
  actor: string,
  decision: "auto" | "approved"
): Promise<ApplyResult["applied"][number]> {
  const parcelIds = v.parcels.map((p) => p.id);
  const lastInvoice = v.parcels.reduce((a, p) => (p.invoiceId > a.invoiceId ? p : a), v.parcels[0]);
  const outcome = v.kind === "return" ? "returned" : "delivered";
  const settlement = await trx<{ id: number }[]>`
    insert into public.carrier_order_settlements (
      order_id, invoice_id, parcel_ids, parcel_count, cod_total, fee_total, confidence, decision,
      settled_by, outcome
    ) values (
      ${v.order.id}, ${lastInvoice.invoiceId}, ${parcelIds}, ${parcelIds.length},
      ${centsToDb(v.codCents)}, ${centsToDb(v.feeCents)}, ${v.confidence}, ${v.manual ? "manual" : decision}, ${actor},
      ${outcome}
    ) returning id
  `;
  const settlementId = settlement[0].id;

  const claimed = await trx`
    update public.carrier_parcels set settlement_id = ${settlementId}
    where id = any(${parcelIds}) and active and settlement_id is null
  `;
  if (claimed.count !== parcelIds.length) {
    throw new Error("تعارض: كرطونة من هاد الطلبية تحسبات فعملية أخرى. عاود المحاولة.");
  }

  let statusChanged = false;
  if (v.willSetDelivered && outcome === "delivered") {
    const changed = await trx`
      update public.orders set status = 'delivered'
      where id = ${v.order.id} and status = ${v.order.status}
    `;
    if (changed.count !== 1) throw new Error(`الطلبية ${v.order.orderNumber} تبدلات أثناء التطبيق.`);
    const invoices = [...new Set(v.parcels.map((p) => p.invoiceNumber))].join(" + ");
    await trx`
      insert into public.order_status_history (order_id, status, note, changed_by)
      values (
        ${v.order.id}, 'delivered',
        ${`تسليم مؤكَّد من فاتورة التوصيل ${invoices} (${parcelIds.length} كرطونة) — تسوية رقم ${settlementId}`},
        ${actor}
      )
    `;
    await logChange(trx, settlementId, v.order.id, "status", v.order.status, "delivered", actor);
    statusChanged = true;
  }

  let costSet = false;
  if (v.willSetCost) {
    const newCost = centsToDb(v.feeCents);
    const oldCost = v.order.actualDeliveryCostCents === null ? null : centsToDb(v.order.actualDeliveryCostCents);
    const changed = await trx`
      update public.orders set actual_delivery_cost = ${newCost}
      where id = ${v.order.id} and actual_delivery_cost is not distinct from ${oldCost}::numeric
    `;
    if (changed.count !== 1) throw new Error(`تكلفة التوصيل ديال ${v.order.orderNumber} تبدلات أثناء التطبيق.`);
    await logChange(trx, settlementId, v.order.id, "actual_delivery_cost", oldCost, newCost, actor);
    costSet = true;
  }

  if (outcome === "returned") {
    const invoices = [...new Set(v.parcels.map((p) => p.invoiceNumber))].join(" + ");
    // ملاحظة في سجل الطلبية بنفس حالتها الحالية: الأثر مكتوب، والحالة ما تبدلاتش.
    await trx`
      insert into public.order_status_history (order_id, status, note, changed_by)
      values (
        ${v.order.id}, ${v.order.status},
        ${`رجعة مؤكَّدة من فاتورة التوصيل ${invoices}: رسوم ${centsToDb(v.feeCents)} درهم خسارة — تسوية رقم ${settlementId}. الحالة ما تبدلاتش.`},
        ${actor}
      )
    `;
  }

  return { orderId: v.order.id, orderNumber: v.order.orderNumber, outcome, statusChanged, costSet };
}

async function logChange(
  trx: Db,
  settlementId: number,
  orderId: number,
  field: "status" | "actual_delivery_cost",
  oldValue: string | null,
  newValue: string | null,
  actor: string
) {
  await trx`
    insert into public.carrier_settlement_changes (settlement_id, order_id, field, old_value, new_value, changed_by)
    values (${settlementId}, ${orderId}, ${field}, ${oldValue}, ${newValue}, ${actor})
  `;
}

// ---------------------------------------------------------------------------
// الربط اليدوي
// ---------------------------------------------------------------------------

export type LinkResult = { ok: true; orderNumber: string } | { ok: false; error: string };

/**
 * المالك كيقول «هاد الكرطونات ديال هاد الطلبية». **ماشي تطبيق**: كيتسجل الربط
 * فقط، ومن بعد نفس المحرك كيحكم على الطلبية وكتبان فـ«تحتاج قرارك» بأدلتها.
 */
export async function linkParcelsToOrder(
  parcelIds: number[],
  orderNumberRaw: string,
  actor: string
): Promise<LinkResult> {
  const orderNumber = orderNumberRaw.trim().toUpperCase();
  const ids = [...new Set(parcelIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return { ok: false, error: "ما اخترتي حتى كرطونة." };
  if (!/^[A-Z0-9-]{3,40}$/.test(orderNumber)) return { ok: false, error: "رقم الطلبية ماشي صحيح (مثال: TF-2026-0340)." };
  return sql.begin(async (trx) => {
    await LOCK_SQL(trx);
    const [order] = await trx<{ id: number; order_number: string; settled: boolean }[]>`
      select o.id, o.order_number,
        exists (select 1 from public.carrier_order_settlements s
                where s.order_id = o.id and s.reverted_at is null) as settled
      from public.orders o where upper(o.order_number) = ${orderNumber}
      for update of o
    `;
    if (!order) return { ok: false as const, error: `ما كايناش طلبية برقم ${orderNumber}.` };
    if (order.settled) return { ok: false as const, error: `${order.order_number} سبق تسويتها.` };
    const parcels = await trx<{ id: number; ok: boolean }[]>`
      select p.id, (p.active and p.settlement_id is null and i.status = 'active') as ok
      from public.carrier_parcels p join public.carrier_invoices i on i.id = p.invoice_id
      where p.id = any(${ids})
      for update of p
    `;
    if (parcels.length !== ids.length || parcels.some((p) => !p.ok))
      return { ok: false as const, error: "شي كرطونة ما بقاتش مفتوحة (تسوّات ولا تراجعتي على فاتورتها)." };
    await trx`
      update public.carrier_parcels
      set manual_order_id = ${order.id}, manual_linked_by = ${actor}, manual_linked_at = now()
      where id = any(${ids})
    `;
    return { ok: true as const, orderNumber: order.order_number };
  });
}

/** فك الربط اليدوي لكرطونات ما تسوّاتش بعد. */
export async function unlinkParcels(parcelIds: number[]): Promise<number> {
  return sql.begin(async (trx) => {
    await LOCK_SQL(trx);
    const r = await trx`
      update public.carrier_parcels
      set manual_order_id = null, manual_linked_by = null, manual_linked_at = null
      where id = any(${parcelIds}) and settlement_id is null and manual_order_id is not null
    `;
    return r.count;
  });
}

// ---------------------------------------------------------------------------
// التراجع
// ---------------------------------------------------------------------------

export type RollbackResult = {
  ok: boolean;
  error?: string;
  revertedOrders: string[];
  kept: { orderNumber: string; detail: string }[];
};

/**
 * التراجع عن فاتورة كاملة.
 *
 * 1. كل تسوية فيها كرطونة واحدة على الأقل من هذه الفاتورة تُعكَس — **ولو
 *    كانت اكتملت بفاتورة أخرى**: طلبية كرطونتاها في فاتورتين لم تعد مكتملة
 *    حين تسقط إحداهما. كرطونات الفاتورة الأخرى تعود «مفتوحة» تنتظر.
 * 2. كل تغيير يُعكَس فقط إن كانت القيمة الحالية ما تزال ما كتبناه. إن غيّرها
 *    أحدٌ بعدنا (حالة راجعة، تكلفة صُحِّحت بيدٍ) تبقى كما هي ويُذكر ذلك.
 * 3. كرطونات الفاتورة تُطفأ، والفاتورة تصير «متراجَعاً عنها» (لا تُحذف).
 */
export async function rollbackInvoice(invoiceId: number, actor: string): Promise<RollbackResult> {
  return sql.begin(async (trx) => {
    await LOCK_SQL(trx);
    const inv = await trx<{ status: string; invoice_number: string }[]>`
      select status, invoice_number from public.carrier_invoices where id = ${invoiceId} for update
    `;
    if (inv.length === 0) return { ok: false, error: "الفاتورة غير موجودة.", revertedOrders: [], kept: [] };
    if (inv[0].status !== "active")
      return { ok: false, error: "سبق التراجع عن هاد الفاتورة.", revertedOrders: [], kept: [] };

    const settlements = await trx<{ id: number }[]>`
      select distinct s.id from public.carrier_order_settlements s
      join public.carrier_parcels p on p.settlement_id = s.id
      where p.invoice_id = ${invoiceId} and s.reverted_at is null
      order by s.id desc
    `;
    const reason = `تراجع عن فاتورة ${inv[0].invoice_number}`;
    const revertedOrders: string[] = [];
    const kept: RollbackResult["kept"] = [];
    for (const s of settlements) {
      const r = await revertSettlement(trx, s.id, actor, reason);
      if (r.orderNumber) revertedOrders.push(r.orderNumber);
      kept.push(...r.kept);
    }

    await trx`update public.carrier_parcels set active = false where invoice_id = ${invoiceId}`;

    // كرطونة تُركت «مكررة» في فاتورة أخرى فعّالة لأنها كانت محسوبة هنا: الآن
    // صارت هذه الفاتورة هي الوحيدة التي تحملها، فتُحتسَب منها. («تعارض» بمبلغ
    // مختلف يبقى خارج الحساب: لا نختار نحن أيّ المبلغين الصحيح.)
    await trx`
      update public.carrier_parcels p
      set active = true, skip_reason = null
      where p.id in (
        select distinct on (d.tracking_code) d.id
        from public.carrier_parcels d
        join public.carrier_invoices di on di.id = d.invoice_id and di.status = 'active'
        join public.carrier_parcels gone on gone.invoice_id = ${invoiceId}
          and gone.carrier = d.carrier and gone.tracking_code = d.tracking_code
        where d.skip_reason = 'duplicate'
          and not exists (
            select 1 from public.carrier_parcels a
            where a.active and a.carrier = d.carrier and a.tracking_code = d.tracking_code
          )
        order by d.tracking_code, d.invoice_id
      )
    `;
    await trx`
      update public.carrier_invoices
      set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = ${actor}
      where id = ${invoiceId}
    `;
    return { ok: true, revertedOrders, kept };
  });
}

async function revertSettlement(
  trx: Db,
  settlementId: number,
  actor: string,
  reason: string
): Promise<{ orderNumber: string | null; kept: RollbackResult["kept"] }> {
  const head = await trx<{ order_id: number | null; order_number: string | null }[]>`
    select s.order_id, o.order_number from public.carrier_order_settlements s
    left join public.orders o on o.id = s.order_id
    where s.id = ${settlementId}
  `;
  const orderId = head[0]?.order_id ?? null;
  const orderNumber = head[0]?.order_number ?? null;
  const kept: RollbackResult["kept"] = [];

  if (orderId !== null) {
    const current = await trx<{ status: string; actual_delivery_cost: string | null }[]>`
      select status, actual_delivery_cost from public.orders where id = ${orderId} for update
    `;
    const changes = await trx<
      { id: number; field: "status" | "actual_delivery_cost"; old_value: string | null; new_value: string | null }[]
    >`
      select id, field, old_value, new_value from public.carrier_settlement_changes
      where settlement_id = ${settlementId} and reverted_at is null and revert_skipped_reason is null
      order by id desc
    `;
    for (const c of changes) {
      if (c.field === "status") {
        const now = current[0]?.status;
        if (now !== c.new_value) {
          const why = `الحالة تبدلات من بعد إلى «${now}» — بقات كما هي.`;
          await skipRevert(trx, c.id, why);
          kept.push({ orderNumber: orderNumber ?? "", detail: why });
          continue;
        }
        await trx`update public.orders set status = ${c.old_value} where id = ${orderId} and status = ${c.new_value}`;
        await trx`
          insert into public.order_status_history (order_id, status, note, changed_by)
          values (${orderId}, ${c.old_value}, ${`${reason} — رجعت الحالة كما كانت قبل التسوية`}, ${actor})
        `;
      } else {
        const now = dbMoneyToCents(current[0]?.actual_delivery_cost ?? null);
        if (now !== dbMoneyToCents(c.new_value)) {
          const why = "تكلفة التوصيل تبدلات بيدك من بعد — بقات كما هي.";
          await skipRevert(trx, c.id, why);
          kept.push({ orderNumber: orderNumber ?? "", detail: why });
          continue;
        }
        await trx`
          update public.orders set actual_delivery_cost = ${c.old_value}::numeric where id = ${orderId}
        `;
      }
      await trx`
        update public.carrier_settlement_changes set reverted_at = now(), reverted_by = ${actor}
        where id = ${c.id}
      `;
    }
  }

  await trx`update public.carrier_parcels set settlement_id = null where settlement_id = ${settlementId}`;
  await trx`
    update public.carrier_order_settlements
    set reverted_at = now(), reverted_by = ${actor}, revert_reason = ${reason}
    where id = ${settlementId}
  `;
  return { orderNumber, kept };
}

async function skipRevert(trx: Db, changeId: number, why: string) {
  await trx`update public.carrier_settlement_changes set revert_skipped_reason = ${why} where id = ${changeId}`;
}

// ---------------------------------------------------------------------------
// البنك والقراءة
// ---------------------------------------------------------------------------

/**
 * الحالة الثالثة: الفلوس وصلات للبنك. المالك يُدخل المبلغ كما ظهر في الحساب،
 * وتاريخ وصوله (لا تاريخ الضغط على الزر) — هو ما يحدّد الشهر في الملخص المالي.
 */
export async function markInvoiceBankReceived(
  invoiceId: number,
  amountCents: Cents | null,
  actor: string,
  receivedOn: string | null = null
): Promise<boolean> {
  const r =
    amountCents === null
      ? await sql`
          update public.carrier_invoices
          set bank_received_at = null, bank_received_amount = null, bank_marked_by = ${actor}
          where id = ${invoiceId}
        `
      : await sql`
          update public.carrier_invoices
          -- بلا شظية بمعاملات داخل الاستعلام (كتعلّق على مجمّع Preview): null ← اليوم.
          set bank_received_at = coalesce((${receivedOn}::date)::timestamp at time zone 'UTC', now()),
            bank_received_amount = ${centsToDb(amountCents)}, bank_marked_by = ${actor}
          where id = ${invoiceId} and status = 'active'
        `;
  return r.count === 1;
}

export type InvoiceSummary = {
  id: number;
  carrier: string;
  carrierLabel: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  carrierStatus: string | null;
  parcelCount: number;
  totalCod: number;
  totalFees: number;
  totalNet: number;
  status: "active" | "rolled_back";
  uploadedAt: string;
  bankReceivedAt: string | null;
  bankReceivedAmount: number | null;
  settledParcels: number;
  /** ملاحظات القراءة، وواش وافق عليها المالك. */
  warnings: string[];
  warningsAcknowledgedAt: string | null;
};

export async function listInvoices(limit = 60): Promise<InvoiceSummary[]> {
  const rows = await sql<
    {
      id: number;
      carrier: string;
      invoice_number: string;
      invoice_date: string | null;
      carrier_status: string | null;
      parcel_count: number;
      total_cod: string;
      total_fees: string;
      total_net: string;
      status: "active" | "rolled_back";
      uploaded_at: Date;
      bank_received_at: Date | null;
      bank_received_amount: string | null;
      settled_parcels: number;
      parse_warnings: string[];
      warnings_acknowledged_at: Date | null;
    }[]
  >`
    select i.id, i.carrier, i.invoice_number, i.invoice_date::text as invoice_date, i.carrier_status,
      i.parcel_count, i.total_cod, i.total_fees, i.total_net, i.status, i.uploaded_at,
      i.bank_received_at, i.bank_received_amount, i.parse_warnings, i.warnings_acknowledged_at,
      (select count(*)::int from public.carrier_parcels p
        where p.invoice_id = i.id and p.settlement_id is not null) as settled_parcels
    from public.carrier_invoices i
    order by coalesce(i.invoice_date, i.uploaded_at::date) desc, i.id desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    carrier: r.carrier,
    carrierLabel: CARRIER_LABEL[r.carrier] ?? r.carrier,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date,
    carrierStatus: r.carrier_status,
    parcelCount: r.parcel_count,
    totalCod: Number(r.total_cod),
    totalFees: Number(r.total_fees),
    totalNet: Number(r.total_net),
    status: r.status,
    uploadedAt: new Date(r.uploaded_at).toISOString(),
    bankReceivedAt: r.bank_received_at ? new Date(r.bank_received_at).toISOString() : null,
    bankReceivedAmount: r.bank_received_amount === null ? null : Number(r.bank_received_amount),
    settledParcels: r.settled_parcels,
    warnings: r.parse_warnings ?? [],
    warningsAcknowledgedAt: r.warnings_acknowledged_at ? new Date(r.warnings_acknowledged_at).toISOString() : null,
  }));
}

export type InvoiceParcelRow = {
  id: number;
  lineNo: number;
  trackingCode: string;
  phone: string | null;
  city: string | null;
  cod: number;
  fee: number;
  status: string;
  statusRaw: string | null;
  pickupDate: string | null;
  active: boolean;
  skipReason: string | null;
  settledOrderId: number | null;
  settledOrderNumber: string | null;
};

export async function getInvoice(
  invoiceId: number
): Promise<{ invoice: InvoiceSummary; parcels: InvoiceParcelRow[] } | null> {
  const all = await listInvoicesById([invoiceId]);
  if (all.length === 0) return null;
  const rows = await sql<
    {
      id: number;
      line_no: number;
      tracking_code: string;
      phone: string | null;
      city: string | null;
      cod_amount: string;
      fee: string;
      carrier_status: string;
      carrier_status_raw: string | null;
      pickup_date: string | null;
      active: boolean;
      skip_reason: string | null;
      order_id: number | null;
      order_number: string | null;
    }[]
  >`
    select p.id, p.line_no, p.tracking_code, p.phone, p.city, p.cod_amount, p.fee, p.carrier_status,
      p.carrier_status_raw, p.pickup_date::text as pickup_date, p.active, p.skip_reason,
      s.order_id, o.order_number
    from public.carrier_parcels p
    left join public.carrier_order_settlements s on s.id = p.settlement_id
    left join public.orders o on o.id = s.order_id
    where p.invoice_id = ${invoiceId}
    order by p.line_no
  `;
  return {
    invoice: all[0],
    parcels: rows.map((r) => ({
      id: Number(r.id),
      lineNo: r.line_no,
      trackingCode: r.tracking_code,
      phone: r.phone,
      city: r.city,
      cod: Number(r.cod_amount),
      fee: Number(r.fee),
      status: r.carrier_status,
      statusRaw: r.carrier_status_raw,
      pickupDate: r.pickup_date,
      active: r.active,
      skipReason: r.skip_reason,
      settledOrderId: r.order_id === null ? null : Number(r.order_id),
      settledOrderNumber: r.order_number,
    })),
  };
}

async function listInvoicesById(ids: number[]): Promise<InvoiceSummary[]> {
  const all = await listInvoices(1000);
  return all.filter((i) => ids.includes(i.id));
}

export async function getInvoiceFile(
  invoiceId: number
): Promise<{ content: Buffer; contentType: string; fileName: string | null } | null> {
  const rows = await sql<{ content: Buffer; content_type: string; file_name: string | null }[]>`
    select f.content, f.content_type, i.file_name
    from public.carrier_invoice_files f join public.carrier_invoices i on i.id = f.invoice_id
    where f.invoice_id = ${invoiceId}
  `;
  if (rows.length === 0) return null;
  return { content: rows[0].content, contentType: rows[0].content_type, fileName: rows[0].file_name };
}

/** تسوية الطلبية الفعّالة (لصفحة الطلب). */
export async function getOrderSettlement(orderId: number): Promise<{
  invoices: { id: number; number: string; carrierLabel: string; bankReceived: boolean }[];
  parcelCount: number;
  feeTotal: number;
  settledAt: string;
  confidence: string;
  outcome: "delivered" | "returned";
} | null> {
  const rows = await sql<
    {
      id: number;
      parcel_count: number;
      fee_total: string;
      settled_at: Date;
      confidence: string;
      parcel_ids: number[];
      outcome: "delivered" | "returned";
    }[]
  >`
    select id, parcel_count, fee_total, settled_at, confidence, parcel_ids, outcome
    from public.carrier_order_settlements
    where order_id = ${orderId} and reverted_at is null
  `;
  if (rows.length === 0) return null;
  const s = rows[0];
  const invoices = await sql<
    { id: number; invoice_number: string; carrier: string; bank_received_at: Date | null }[]
  >`
    select distinct i.id, i.invoice_number, i.carrier, i.bank_received_at
    from public.carrier_parcels p join public.carrier_invoices i on i.id = p.invoice_id
    where p.id = any(${s.parcel_ids.map(Number)})
    order by i.id
  `;
  return {
    invoices: invoices.map((i) => ({
      id: Number(i.id),
      number: i.invoice_number,
      carrierLabel: CARRIER_LABEL[i.carrier] ?? i.carrier,
      bankReceived: i.bank_received_at !== null,
    })),
    parcelCount: s.parcel_count,
    feeTotal: Number(s.fee_total),
    settledAt: new Date(s.settled_at).toISOString(),
    confidence: s.confidence,
    outcome: s.outcome,
  };
}

// ---------------------------------------------------------------------------
// الربح بعد التوصيل للطلبيات المعروضة
// ---------------------------------------------------------------------------

export type ProfitLineRow = {
  order_id: number;
  quantity: number;
  unit_price_snapshot: string;
  purchase_price_snapshot: string | null;
  current_purchase_price: string | null;
  line_status: string;
};

export async function loadProfitLines(orderIds: number[]): Promise<Map<number, ProfitLineRow[]>> {
  const map = new Map<number, ProfitLineRow[]>();
  if (orderIds.length === 0) return map;
  const rows = await sql<ProfitLineRow[]>`
    select oi.order_id, oi.quantity, oi.unit_price_snapshot, oi.purchase_price_snapshot,
      coalesce(pv.purchase_price_override, p.purchase_price) as current_purchase_price,
      oi.line_status
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    left join public.product_variants pv on pv.id = oi.variant_id
    where oi.order_id = any(${orderIds})
    order by oi.id
  `;
  for (const r of rows) {
    const id = Number(r.order_id);
    map.set(id, [...(map.get(id) ?? []), r]);
  }
  return map;
}
