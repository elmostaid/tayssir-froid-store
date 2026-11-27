// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

/**
 * الطلبيات القديمة اللي علّمها المالك «مسلَّمة» بيدو (166 فالإنتاج)، ومن بعد
 * كترفع الفاتورة القديمة ديالها:
 * - الحالة والتواريخ التاريخية ما كتبدلش (created_at، سجل الحالات).
 * - غير تكلفة التوصيل الحقيقية كتتسجل، ومرة وحدة.
 * - الربح كيتحسب مرة وحدة، حتى إلا عاودنا رفع الفاتورة ولا جات الكرطونة ففاتورة أخرى.
 * - لا Purchase كيتصيفط.
 */

const capiSpy = vi.fn();
const deferredSpy = vi.fn();
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: capiSpy, isCapiConfigured: () => true, hashForCapi: (v: string) => v }));
vi.mock("@/lib/pixel/sendDeferredPurchase", () => ({ sendDeferredPurchase: deferredSpy }));

const { extractPdfTextItems } = await import("@/lib/settlements/pdfText");
const { parseBigDeliveryInvoice } = await import("@/lib/settlements/bigDeliveryInvoice");
const store = await import("@/lib/settlements/settlementStore");
const { getFinanceSummary, resolvePeriod } = await import("@/lib/settlements/financeSummary");
const { buildFakeBigDeliveryPdf } = await import("./fakeBigDeliveryPdf");
type FakeParcel = import("./fakeBigDeliveryPdf").FakeParcel;

const RUN = String(Date.now()).slice(-6);
const ACTOR = "owner-old@tayssir.local";
const SKU = `OLD-${RUN}`;
const PHONE = `05${RUN}77`;
const CREATED = "2032-01-03T09:15:00.000Z";
const JAN = resolvePeriod("2032-01");

let productId = 0;
let orderId = 0;
const invoiceIds: number[] = [];

async function upload(number: string, parcels: FakeParcel[]) {
  const pdf = buildFakeBigDeliveryPdf({ number, date: "2032-01-12", parcels });
  const parsed = parseBigDeliveryInvoice(await extractPdfTextItems(pdf));
  if (!parsed.ok) throw new Error(parsed.problems.join("\n"));
  const r = await store.registerInvoice({
    parsed: parsed.invoice,
    bytes: pdf,
    fileName: `${number}.pdf`,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    actor: ACTOR,
  });
  if ("invoiceId" in r && !invoiceIds.includes(r.invoiceId)) invoiceIds.push(r.invoiceId);
  return r;
}

const parcel: FakeParcel = { code: `BG${RUN}OLD`, pickup: "2032-01-05", phone: PHONE, cityLines: ["Fes"], cod: 1035, fee: 45 };

async function snapshot() {
  const [o] = await sql<{ status: string; created_at: Date; actual_delivery_cost: string | null; meta_purchase_sent_at: Date | null }[]>`
    select status, created_at, actual_delivery_cost, meta_purchase_sent_at from public.orders where id = ${orderId}
  `;
  const history = await sql<{ status: string; changed_at: Date }[]>`
    select status, changed_at from public.order_status_history where order_id = ${orderId} order by id
  `;
  return { ...o, created_at: new Date(o.created_at).toISOString(), history: history.map((h) => [h.status, new Date(h.changed_at).toISOString()]) };
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [p] = await sql<{ id: number }[]>`
    insert into public.products (category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
      stock_quantity, min_order_qty, qty_increment, status)
    values (${category.id}, ${SKU}, ${SKU.toLowerCase()}, 'منتج قديم', 'قطعة', 100, 60, 50, 1, 1, 'published')
    returning id
  `;
  productId = p.id;
  const [o] = await sql<{ id: number }[]>`
    insert into public.orders (customer_name, customer_phone, customer_city, items_subtotal, delivery_fee, final_total,
      status, source, idempotency_key, created_at, confirmed_at)
    values ('زبون قديم', ${PHONE}, 'فاس', 1000, 35, 1035, 'delivered', 'manual', ${`old-${RUN}`}, ${CREATED}, ${CREATED})
    returning id
  `;
  orderId = o.id;
  await sql`
    insert into public.order_items (order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
      unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status)
    values (${orderId}, ${productId}, null, 'منتج قديم', ${SKU}, 1000, 1, 1000, 700, 'reserved')
  `;
  // التسليم اليدوي القديم كما وقع: سطر في السجل بتاريخه.
  await sql`
    insert into public.order_status_history (order_id, status, note, changed_by, changed_at)
    values (${orderId}, 'delivered', 'تسليم يدوي', 'owner', '2032-01-06T10:00:00Z')
  `;
});

afterAll(async () => {
  await sql`delete from public.carrier_settlement_changes where order_id = ${orderId}`;
  await sql`update public.carrier_parcels set settlement_id = null where invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_order_settlements where order_id = ${orderId} or invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_parcels where invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_invoices where id = any(${invoiceIds})`;
  await sql`delete from public.order_status_history where order_id = ${orderId}`;
  await sql`delete from public.orders where id = ${orderId}`;
  await sql`delete from public.products where id = ${productId}`;
});

describe("فواتير قديمة لطلبيات مسلَّمة يدوياً", () => {
  let before: Awaited<ReturnType<typeof snapshot>>;

  test("الطلبية المسلَّمة كتبان «جاهزة» لتسجيل التكلفة فقط، بلا تغيير حالة", async () => {
    before = await snapshot();
    await upload(`OLD-${RUN}-1`, [parcel]);
    const board = await store.computeBoard();
    const v = board.orders.find((x) => x.order.id === orderId);
    expect(v).toMatchObject({ kind: "ready", willSetDelivered: false, willSetCost: true, feeCents: 4500 });
  });

  test("التطبيق: التكلفة الحقيقية فقط — الحالة والتواريخ وسجل الحالات كما كانو", async () => {
    const res = await store.applySettlements({ readyOrderIds: [orderId], approvedOrderIds: [], actor: ACTOR });
    expect(res.applied).toEqual([expect.objectContaining({ orderId, statusChanged: false, costSet: true })]);
    const after = await snapshot();
    expect(after).toEqual({ ...before, actual_delivery_cost: "45.00" });
  });

  test("الربح كيتحسب مرة وحدة: 1000 − 700 + 35 − 45 = 290", async () => {
    const f = await getFinanceSummary(JAN);
    const mine = f.realized.orders.filter((o) => o.orderId === orderId);
    expect(mine).toHaveLength(1);
    expect(mine[0].profitCents).toBe(29000);
  });

  test("عاودنا رفع نفس الفاتورة، ولا جات نفس الكرطونة ففاتورة أخرى: والو ما كيتزاد", async () => {
    expect((await upload(`OLD-${RUN}-1`, [parcel])).kind).toBe("already_active");
    const dup = await upload(`OLD-${RUN}-2`, [parcel]);
    expect(dup).toMatchObject({ kind: "created", duplicates: 1 });
    const res = await store.applySettlements({ readyOrderIds: [orderId], approvedOrderIds: [orderId], actor: ACTOR });
    expect(res.applied).toHaveLength(0);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.carrier_order_settlements where order_id = ${orderId} and reverted_at is null
    `;
    expect(n).toBe(1);
    const f = await getFinanceSummary(JAN);
    expect(f.realized.orders.filter((o) => o.orderId === orderId)).toHaveLength(1);
    expect(f.realized.deliveryRealCents).toBe(4500);
  });

  test("لا Purchase، والتاريخ ديال الإرسال ما تقاسش", async () => {
    expect(capiSpy).not.toHaveBeenCalled();
    expect(deferredSpy).not.toHaveBeenCalled();
    expect((await snapshot()).meta_purchase_sent_at).toBeNull();
  });
});
