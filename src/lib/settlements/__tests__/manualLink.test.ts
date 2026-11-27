// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

/**
 * الربط اليدوي الآمن + التقريب + الأرقام العربية، على قاعدة معزولة.
 * الربط ماشي تطبيق؛ والتطبيق كيبقى بموافقة، ومسجَّل «manual».
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
const ACTOR = "owner-link@tayssir.local";
const SKU = `LINK-${RUN}`;
const FEB = resolvePeriod("2033-02");
const code = (s: string) => `BG${RUN}${s}`;
const ar = (latin: string) => latin.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

let productId = 0;
const orders: Record<string, number> = {};
const numbers: Record<string, string> = {};
const invoiceIds: number[] = [];

async function seedOrder(key: string, o: { phone: string; subtotal: number; fee: number; cogs: number; status?: string; created?: string }) {
  const [row] = await sql<{ id: number; order_number: string }[]>`
    insert into public.orders (customer_name, customer_phone, customer_city, items_subtotal, delivery_fee, final_total,
      status, source, idempotency_key, created_at, confirmed_at)
    values ('زبون ربط', ${o.phone}, 'فاس', ${o.subtotal}, ${o.fee}, ${o.subtotal + o.fee}, ${o.status ?? "shipped"},
      'manual', ${`link-${RUN}-${key}`}, ${o.created ?? "2033-02-01T10:00:00Z"}, now())
    returning id, order_number
  `;
  await sql`
    insert into public.order_items (order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
      unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status)
    values (${row.id}, ${productId}, null, 'منتج ربط', ${SKU}, ${o.subtotal}, 1, ${o.subtotal}, ${o.cogs}, 'reserved')
  `;
  orders[key] = row.id;
  numbers[key] = row.order_number;
}

async function upload(number: string, parcels: FakeParcel[]) {
  const pdf = buildFakeBigDeliveryPdf({ number, date: "2033-02-10", parcels });
  const parsed = parseBigDeliveryInvoice(await extractPdfTextItems(pdf));
  if (!parsed.ok) throw new Error(parsed.problems.join("\n"));
  const r = await store.registerInvoice({
    parsed: parsed.invoice, bytes: pdf, fileName: `${number}.pdf`,
    sha256: createHash("sha256").update(pdf).digest("hex"), actor: ACTOR,
  });
  if (!("invoiceId" in r)) throw new Error("upload");
  invoiceIds.push(r.invoiceId);
  return r.invoiceId;
}

const parcelIds = async (codes: string[]) =>
  (await sql<{ id: number }[]>`select id from public.carrier_parcels where tracking_code = any(${codes}) and active order by line_no`).map((r) => Number(r.id));

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [p] = await sql<{ id: number }[]>`
    insert into public.products (category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
      stock_quantity, min_order_qty, qty_increment, status)
    values (${category.id}, ${SKU}, ${SKU.toLowerCase()}, 'منتج ربط', 'قطعة', 100, 60, 50, 1, 1, 'published') returning id
  `;
  productId = p.id;
  // L: الزبون عطا لشركة التوصيل هاتف آخر → ربط يدوي.
  await seedOrder("L", { phone: `0611${RUN}`, subtotal: 370, fee: 35, cogs: 250 });
  // R: 1,705 على جوج كرطونات = 853 + 853 (تقريب +1). هاتفها مكتوب بالأرقام العربية.
  await seedOrder("R", { phone: ar(`0622${RUN}`), subtotal: 1670, fee: 35, cogs: 1200 });
  // S: طلبية سبق تسويتها (للتأكد أن الربط بها مرفوض).
  await seedOrder("S", { phone: `0633${RUN}`, subtotal: 600, fee: 35, cogs: 400 });

  await upload(`LNK-${RUN}-1`, [
    { code: code("LA"), pickup: "2033-02-03", phone: `0699${RUN}`, cityLines: ["Fes"], cod: 405, fee: 35 },
    { code: code("RA"), pickup: "2033-02-03", phone: `0622${RUN}`, cityLines: ["Fes"], cod: 853, fee: 35 },
    { code: code("RB"), pickup: "2033-02-03", phone: `0622${RUN}`, cityLines: ["Fes"], cod: 853, fee: 80 },
    { code: code("SA"), pickup: "2033-02-03", phone: `0633${RUN}`, cityLines: ["Fes"], cod: 635, fee: 35 },
  ]);
  await store.applySettlements({ readyOrderIds: [orders.S], approvedOrderIds: [orders.S], actor: ACTOR });
});

afterAll(async () => {
  const ids = Object.values(orders);
  await sql`delete from public.carrier_settlement_changes where order_id = any(${ids})`;
  await sql`update public.carrier_parcels set settlement_id = null where invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_order_settlements where order_id = any(${ids}) or invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_parcels where invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_invoices where id = any(${invoiceIds})`;
  await sql`delete from public.order_status_history where order_id = any(${ids})`;
  await sql`delete from public.orders where id = any(${ids})`;
  await sql`delete from public.products where id = ${productId}`;
});

describe("ربط يدوي، تقريب، أرقام عربية", () => {
  test("الهاتف بالأرقام العربية كيتطابق، و853+853 لطلبية 1,705 → قرار بفرق +1", async () => {
    const board = await store.computeBoard();
    const v = board.orders.find((x) => x.order.id === orders.R);
    expect(v).toMatchObject({ kind: "decide", roundingCents: 100, codCents: 170600, feeCents: 11500 });
  });

  test("كرطونة بهاتف آخر: بلا طلبية حتى يربطها المالك", async () => {
    const board = await store.computeBoard();
    const [la] = await parcelIds([code("LA")]);
    expect(board.parcelGroups.some((g) => g.parcels.some((p) => p.id === la))).toBe(true);
    expect(board.orders.some((x) => x.order.id === orders.L)).toBe(false);
  });

  test("الربط برقم غالط ولا بطلبية مسوّاة كيترفض، وما كيتسجل والو", async () => {
    const [la] = await parcelIds([code("LA")]);
    expect(await store.linkParcelsToOrder([la], "TF-0000-0000", ACTOR)).toMatchObject({ ok: false });
    expect(await store.linkParcelsToOrder([la], numbers.S, ACTOR)).toMatchObject({ ok: false, error: expect.stringMatching(/سبق تسويتها/) });
    const [row] = await sql<{ manual_order_id: number | null }[]>`select manual_order_id from public.carrier_parcels where id = ${la}`;
    expect(row.manual_order_id).toBeNull();
  });

  test("الربط ماشي تطبيق: الطلبية كتبان «تحتاج قرارك» (ربط يدوي) وما تبدل حتى حاجة فيها", async () => {
    const [la] = await parcelIds([code("LA")]);
    expect(await store.linkParcelsToOrder([la], numbers.L.toLowerCase(), ACTOR)).toEqual({ ok: true, orderNumber: numbers.L });
    const [o] = await sql<{ status: string; actual_delivery_cost: string | null }[]>`select status, actual_delivery_cost from public.orders where id = ${orders.L}`;
    expect(o).toEqual({ status: "shipped", actual_delivery_cost: null });
    const v = (await store.computeBoard()).orders.find((x) => x.order.id === orders.L);
    expect(v).toMatchObject({ kind: "decide", manual: true, preselect: false });
    // «اختار جميع الجاهزة» ما كتطبقهاش.
    const res = await store.applySettlements({ readyOrderIds: [orders.L], approvedOrderIds: [], actor: ACTOR });
    expect(res.applied).toHaveLength(0);
  });

  test("فك الربط كيرجعها بلا طلبية، وعاود الربط ممكن", async () => {
    const [la] = await parcelIds([code("LA")]);
    expect(await store.unlinkParcels([la])).toBe(1);
    expect((await store.computeBoard()).orders.some((x) => x.order.id === orders.L)).toBe(false);
    expect((await store.linkParcelsToOrder([la], numbers.L, ACTOR)).ok).toBe(true);
  });

  test("الموافقة: التسوية كتتسجل «manual»، والتقريب كيتطبق بموافقة", async () => {
    const res = await store.applySettlements({ readyOrderIds: [], approvedOrderIds: [orders.L, orders.R], actor: ACTOR });
    expect(res.applied.map((a) => a.orderId).sort()).toEqual([orders.L, orders.R].sort());
    const rows = await sql<{ order_id: number; decision: string }[]>`
      select order_id, decision from public.carrier_order_settlements where order_id = any(${[orders.L, orders.R]}) and reverted_at is null
    `;
    expect(Object.fromEntries(rows.map((r) => [Number(r.order_id), r.decision]))).toEqual({ [orders.L]: "manual", [orders.R]: "approved" });
    // ما يقدرش يتفك الربط من بعد التسوية.
    const [la] = await parcelIds([code("LA")]);
    expect(await store.unlinkParcels([la])).toBe(0);
  });

  test("الربح على اللي تحصّل فعلاً: R = 1670 − 1200 + 35 − 115 + 1 (تقريب) = 391", async () => {
    const f = await getFinanceSummary(FEB);
    const r = f.realized.orders.find((o) => o.orderId === orders.R);
    expect(r).toMatchObject({ collectedCents: 170600, profitCents: 39100 });
    const l = f.realized.orders.find((o) => o.orderId === orders.L);
    expect(l).toMatchObject({ profitCents: 12000 }); // 370 − 250 + 35 − 35
  });

  test("لا Purchase", () => {
    expect(capiSpy).not.toHaveBeenCalled();
    expect(deferredSpy).not.toHaveBeenCalled();
  });
});
