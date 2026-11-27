// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

/**
 * أرشيف الطلبيات المُرسَلة (قرارات المالك 2026-11-27):
 * - مطابقة مؤكدة بلا عدد كرطونات → «جاهزة» ومعلَّمة، والفرق (الاكتمال ما موثقش) محفوظ.
 * - «موافقة سريعة» للتكلفة اليدوية والتقريب فقط؛ أي مشكل آخر كيبقى للمراجعة.
 * - مدينة ما قدرتش تتقارن ماشي مؤكدة.
 * - كرطونة زايدة من بعد: تكلفتها كتتزاد على نفس التسوية، بلا مبيعات ولا ربح مكرَّر.
 * - البنك لعدة كشوفات بضغطة، منفصل على التسليم.
 * - لا Purchase.
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
const ACTOR = "owner-archive@tayssir.local";
const SKU = `ARC-${RUN}`;
const FEB = resolvePeriod("2033-02");
const phone = (n: number) => `06${RUN}${String(n).padStart(2, "0")}`;
const code = (s: string) => `BGARC${RUN}${s}`;

let productId = 0;
const orders: Record<string, number> = {};
const invoiceIds: number[] = [];

async function upload(number: string, parcels: FakeParcel[]) {
  const pdf = buildFakeBigDeliveryPdf({ number, date: "2033-02-10", parcels });
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

async function makeOrder(key: string, n: number, city: string, total: number, cost: number | null) {
  const [o] = await sql<{ id: number }[]>`
    insert into public.orders (customer_name, customer_phone, customer_city, items_subtotal, delivery_fee, final_total,
      status, source, idempotency_key, created_at, confirmed_at, actual_delivery_cost)
    values ('زبون أرشيف', ${phone(n)}, ${city}, ${total - 35}, 35, ${total}, 'shipped', 'manual', ${`arc-${RUN}-${key}`},
      '2033-02-01T09:00:00Z', '2033-02-01T09:00:00Z', ${cost})
    returning id
  `;
  orders[key] = o.id;
  await sql`
    insert into public.order_items (order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
      unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status)
    values (${o.id}, ${productId}, null, 'منتج أرشيف', ${SKU}, ${total - 35}, 1, ${total - 35}, 200, 'reserved')
  `;
}

const state = async (key: string) => {
  const [o] = await sql<{ status: string; actual_delivery_cost: string | null; meta_purchase_sent_at: Date | null }[]>`
    select status, actual_delivery_cost, meta_purchase_sent_at from public.orders where id = ${orders[key]}
  `;
  return o;
};
const verdict = async (key: string) => (await store.computeBoard()).orders.find((v) => v.order.id === orders[key]);

const P = (s: string, n: number, cod: number, fee: number, city = "Fes", status?: string): FakeParcel => ({
  code: code(s), pickup: "2033-02-03", phone: phone(n), cityLines: [city], cod, fee, ...(status ? { status } : {}),
});

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [p] = await sql<{ id: number }[]>`
    insert into public.products (category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
      stock_quantity, min_order_qty, qty_increment, status)
    values (${category.id}, ${SKU}, ${SKU.toLowerCase()}, 'منتج أرشيف', 'قطعة', 100, 60, 50, 1, 1, 'published')
    returning id
  `;
  productId = p.id;
  await makeOrder("A", 1, "فاس", 500, null); // مؤكدة، بلا عدد كرطونات
  await makeOrder("B", 2, "فاس", 600, 20); // تكلفة يدوية 20، الفاتورة 35
  await makeOrder("C", 3, "فاس", 701, null); // تقريب: الشركة حصّلات 700
  await makeOrder("D", 4, "الجديدة", 800, 20); // تكلفة يدوية + مدينة مختلفة → ماشي سريعة
  await makeOrder("E", 5, "-", 900, null); // مدينة ما تتقارنش → ماشي مؤكدة
});

afterAll(async () => {
  const ids = Object.values(orders);
  await sql`delete from public.carrier_settlement_changes where order_id = any(${ids})`;
  await sql`update public.carrier_parcels set settlement_id = null where invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_order_settlements where order_id = any(${ids}) or invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_parcels where invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_invoices where id = any(${invoiceIds})`;
  await sql`delete from public.order_status_history where order_id = any(${ids})`;
  await sql`delete from public.order_items where order_id = any(${ids})`;
  await sql`delete from public.orders where id = any(${ids})`;
  await sql`delete from public.products where id = ${productId}`;
});

describe("أرشيف: رفع، ملخص، موافقة", () => {
  test("التصنيف: A مؤكدة ومعلَّمة؛ B وC سريعة؛ D وE للمراجعة", async () => {
    await upload(`ARC-${RUN}-1`, [
      P("A", 1, 500, 35),
      P("B", 2, 600, 35),
      P("C", 3, 700, 35),
      P("D", 4, 800, 35, "Agadir"),
      P("E", 5, 900, 35),
    ]);
    const a = await verdict("A");
    expect(a).toMatchObject({ kind: "ready", preselect: true, confidence: "medium", issues: [] });
    const b = await verdict("B");
    expect(b).toMatchObject({ kind: "decide", issues: ["manual_cost"] });
    expect(store.isQuickApprovable(b!)).toBe(true);
    const c = await verdict("C");
    expect(c).toMatchObject({ kind: "decide", issues: ["rounding"], roundingCents: -100 });
    expect(store.isQuickApprovable(c!)).toBe(true);
    const d = await verdict("D");
    expect(d!.issues).toEqual(expect.arrayContaining(["manual_cost", "city_differ"]));
    expect(store.isQuickApprovable(d!)).toBe(false);
    const e = await verdict("E");
    expect(e).toMatchObject({ kind: "decide", city: "unknown", issues: ["city_unknown"] });
    expect(store.isQuickApprovable(e!)).toBe(false);
  });

  test("التطبيق: المؤكدة + السريعة؛ D وE ما كيتطبّقوش من «السريعة» حتى لو تصيفطو", async () => {
    const res = await store.applySettlements({
      readyOrderIds: [orders.A],
      approvedOrderIds: [],
      quickOrderIds: [orders.B, orders.C, orders.D, orders.E],
      actor: ACTOR,
    });
    expect(res.applied.map((x) => x.orderId).sort()).toEqual([orders.A, orders.B, orders.C].sort());
    expect(res.skipped.map((x) => x.orderId).sort()).toEqual([orders.D, orders.E].sort());
    expect(await state("A")).toMatchObject({ status: "delivered", actual_delivery_cost: "35.00" });
    expect(await state("B")).toMatchObject({ status: "delivered", actual_delivery_cost: "35.00" });
    expect(await state("C")).toMatchObject({ status: "delivered", actual_delivery_cost: "35.00" });
    expect(await state("D")).toMatchObject({ status: "shipped", actual_delivery_cost: "20.00" });
    expect(await state("E")).toMatchObject({ status: "shipped", actual_delivery_cost: null });
    const [{ conf }] = await sql<{ conf: string }[]>`
      select confidence as conf from public.carrier_order_settlements where order_id = ${orders.A} and reverted_at is null
    `;
    expect(conf).toBe("medium"); // الاكتمال ما موثقش — محفوظ فالتسوية
  });

  test("الربح على اللي تحصّل فعلاً: C = 700 − 200 − 35 = 465 (ماشي 466)", async () => {
    const f = await getFinanceSummary(FEB);
    const c = f.realized.orders.find((o) => o.orderId === orders.C)!;
    expect(c.collectedCents).toBe(70000);
    expect(c.profitCents).toBe(46500);
  });

  test("كرطونة زايدة بلا تحصيل لـA فكشف آخر: تكلفتها كتتزاد مرة وحدة، والمبيعات ما تتعاودش", async () => {
    const before = (await getFinanceSummary(FEB)).realized.orders.find((o) => o.orderId === orders.A)!;
    await upload(`ARC-${RUN}-2`, [P("A2", 1, 0, 20)]);
    const board = await store.computeBoard();
    const g = board.parcelGroups.find((x) => x.parcels.some((p) => p.trackingCode === code("A2")))!;
    expect(g).toMatchObject({ kind: "extra" });
    expect(g.extraFor?.id).toBe(orders.A);

    const r = await store.addExtraParcelsToSettlement(g.parcels.map((p) => p.id), orders.A, ACTOR);
    expect(r).toMatchObject({ ok: true, addedCents: 2000 });
    expect(await state("A")).toMatchObject({ status: "delivered", actual_delivery_cost: "55.00" });
    // مرة ثانية: الكرطونة محسوبة — ما تتزادش.
    const again = await store.addExtraParcelsToSettlement(g.parcels.map((p) => p.id), orders.A, ACTOR);
    expect(again.ok).toBe(false);
    // نفس الكشف مرة أخرى: «سبق رفعو»، والتكلفة ما تبدلاتش.
    expect((await upload(`ARC-${RUN}-2`, [P("A2", 1, 0, 20)])).kind).toBe("already_active");
    expect(await state("A")).toMatchObject({ actual_delivery_cost: "55.00" });

    const f = await getFinanceSummary(FEB);
    const mine = f.realized.orders.filter((o) => o.orderId === orders.A);
    expect(mine).toHaveLength(1);
    expect(mine[0].salesCents).toBe(before.salesCents);
    expect(mine[0].collectedCents).toBe(50000);
    expect(mine[0].deliveryRealCents).toBe(5500);
    expect(mine[0].profitCents).toBe(before.profitCents - 2000);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.carrier_order_settlements where order_id = ${orders.A} and reverted_at is null
    `;
    expect(n).toBe(1);
  });

  test("كرطونة بتحصيل لطلبية مسوّاة ماشي «زايدة»: كتبقى للمراجعة", async () => {
    await upload(`ARC-${RUN}-3`, [P("B2", 2, 150, 20)]);
    const g = (await store.computeBoard()).parcelGroups.find((x) => x.parcels.some((p) => p.trackingCode === code("B2")))!;
    expect(g.kind).toBe("extra");
    expect(g.extraFor).toBeUndefined();
    const r = await store.addExtraParcelsToSettlement(g.parcels.map((p) => p.id), orders.B, ACTOR);
    expect(r.ok).toBe(false);
    expect(await state("B")).toMatchObject({ actual_delivery_cost: "35.00" });
  });

  test("البنك: جوج كشوفات بضغطة، بصافي كل واحد وتاريخ الوصول؛ التسليم ما كيتقاسش", async () => {
    const n = await store.markInvoicesBankReceived(invoiceIds.slice(0, 2), "2033-02-20", ACTOR);
    expect(n).toBe(2);
    expect(await store.markInvoicesBankReceived(invoiceIds.slice(0, 2), "2033-02-21", ACTOR)).toBe(0);
    const rows = await sql<{ net: string; got: string; at: Date }[]>`
      select total_net as net, bank_received_amount as got, bank_received_at as at
      from public.carrier_invoices where id = any(${invoiceIds.slice(0, 2)})
    `;
    for (const r of rows) {
      expect(Number(r.got)).toBe(Math.max(Number(r.net), 0));
      expect(new Date(r.at).toISOString().slice(0, 10)).toBe("2033-02-20");
    }
    const f = await getFinanceSummary(FEB);
    expect(f.realized.orders.find((o) => o.orderId === orders.A)!.banked).toBe(true);
    expect(await state("D")).toMatchObject({ status: "shipped" });
  });

  test("التراجع عن كشف الكرطونة الزايدة: كيرجع كلشي، والكرطونة الأولى كترجع مفتوحة بلا تكرار", async () => {
    const r = await store.rollbackInvoice(invoiceIds[1], ACTOR);
    expect(r.ok).toBe(true);
    expect(await state("A")).toMatchObject({ status: "shipped", actual_delivery_cost: null });
    const a = await verdict("A");
    expect(a).toMatchObject({ kind: "ready", feeCents: 3500 });
  });

  test("لا Purchase", async () => {
    expect(capiSpy).not.toHaveBeenCalled();
    expect(deferredSpy).not.toHaveBeenCalled();
    for (const k of Object.keys(orders)) expect((await state(k)).meta_purchase_sent_at).toBeNull();
  });
});
