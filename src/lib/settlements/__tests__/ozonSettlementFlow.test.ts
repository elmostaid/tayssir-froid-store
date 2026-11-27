// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

/**
 * كشف OzonExpress على قاعدة معزولة، من الرفع حتى صفحة التقارير:
 * - فرق «Total Colis» كيتحفظ مع الكشف، وما كتطبّق حتى تسوية حتى يوافق المالك.
 * - الطلبية المسوّاة كتدخل لصفحة «التقارير والأرباح» الموجودة، مرة وحدة، بتكلفة التوصيل الحقيقية.
 * - BigDelivery ما تأثرش (فاتورة بلا ملاحظات كتطبّق عادي).
 */

const capiSpy = vi.fn();
const deferredSpy = vi.fn();
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: capiSpy, isCapiConfigured: () => true, hashForCapi: (v: string) => v }));
vi.mock("@/lib/pixel/sendDeferredPurchase", () => ({ sendDeferredPurchase: deferredSpy }));

const { extractPdfTextItems } = await import("@/lib/settlements/pdfText");
const { parseOzonExpressInvoice } = await import("@/lib/settlements/ozonExpressInvoice");
const store = await import("@/lib/settlements/settlementStore");
const reports = await import("@/lib/queries/adminReports");
const { buildFakeOzonExpressPdf } = await import("./fakeOzonExpressPdf");

const RUN = String(Date.now()).slice(-6);
const ACTOR = "owner-ozon@tayssir.local";
const SKU = `OZN-${RUN}`;
const PHONE = `0644${RUN}`;
const RANGE = { from: new Date("2034-01-01T00:00:00Z"), to: new Date("2034-02-01T00:00:00Z") };

let productId = 0;
let orderId = 0;
let invoiceId = 0;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [p] = await sql<{ id: number }[]>`
    insert into public.products (category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
      stock_quantity, min_order_qty, qty_increment, status)
    values (${category.id}, ${SKU}, ${SKU.toLowerCase()}, 'منتج أوزون', 'قطعة', 100, 60, 50, 1, 1, 'published') returning id
  `;
  productId = p.id;
  // بحال TF-2026-0284: 6 كرطونات = 3,400، توصيل محصَّل 100 ومسجَّل بيد 100، والكشف كيقول 340.
  const [o] = await sql<{ id: number }[]>`
    insert into public.orders (customer_name, customer_phone, customer_city, items_subtotal, delivery_fee, final_total,
      status, source, idempotency_key, created_at, confirmed_at, actual_delivery_cost)
    values ('زبون أوزون', ${PHONE}, 'القصر الكبير', 3300, 100, 3400, 'shipped', 'manual', ${`ozon-${RUN}`},
      '2034-01-10T10:00:00Z', '2034-01-10T10:00:00Z', 100) returning id
  `;
  orderId = o.id;
  await sql`
    insert into public.order_items (order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
      unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status)
    values (${orderId}, ${productId}, null, 'منتج أوزون', ${SKU}, 3300, 1, 3300, 2797.5, 'reserved')
  `;
  const cods = [567, 567, 567, 567, 567, 565];
  const fees = [80, 45, 45, 45, 45, 80];
  const pdf = buildFakeOzonExpressPdf({
    number: `VRT-N-${RUN}-OZFLOW`,
    date: "2034-01-14",
    totalColis: 2840,
    parcels: cods.map((cod, i) => ({
      code: `KS${RUN}00000${i}`, suffix: i === 1 ? "" : "RM", phone: PHONE, city: "Ksar El Kebir",
      cod, fee: fees[i], pickup: "2034-01-12", delivery: "2034-01-13",
    })),
  });
  const parsed = parseOzonExpressInvoice(await extractPdfTextItems(pdf));
  if (!parsed.ok) throw new Error(parsed.problems.join());
  const r = await store.registerInvoice({
    parsed: parsed.invoice, bytes: pdf, fileName: "ozon.pdf",
    sha256: createHash("sha256").update(pdf).digest("hex"), actor: ACTOR, warnings: parsed.warnings,
  });
  if (!("invoiceId" in r)) throw new Error("register");
  invoiceId = r.invoiceId;
});

afterAll(async () => {
  await sql`delete from public.carrier_settlement_changes where order_id = ${orderId}`;
  await sql`update public.carrier_parcels set settlement_id = null where invoice_id = ${invoiceId}`;
  await sql`delete from public.carrier_order_settlements where order_id = ${orderId} or invoice_id = ${invoiceId}`;
  await sql`delete from public.carrier_parcels where invoice_id = ${invoiceId}`;
  await sql`delete from public.carrier_invoices where id = ${invoiceId}`;
  await sql`delete from public.order_status_history where order_id = ${orderId}`;
  await sql`delete from public.orders where id = ${orderId}`;
  await sql`delete from public.products where id = ${productId}`;
});

describe("OzonExpress: فرق المجاميع، الموافقة، والتقارير", () => {
  test("الفرق كيتحفظ مع الكشف، والطلبية ما كتطبّقش حتى لو اختارها المالك", async () => {
    const [inv] = (await store.listInvoices(200)).filter((i) => i.id === invoiceId);
    expect(inv.carrier).toBe("ozonexpress");
    expect(inv.warnings.join()).toMatch(/Total Colis.*560,00/);
    expect(inv.warningsAcknowledgedAt).toBeNull();

    const v = (await store.computeBoard()).orders.find((x) => x.order.id === orderId);
    expect(v).toMatchObject({ kind: "decide", invoiceWarningPending: true, codCents: 340000, feeCents: 34000, preselect: false });
    expect(v!.reasons.join()).toMatch(/فرق فالمجاميع ما وافقتيش عليه/);

    const res = await store.applySettlements({ readyOrderIds: [orderId], approvedOrderIds: [orderId], actor: ACTOR });
    expect(res.applied).toHaveLength(0);
    const [o] = await sql<{ status: string; actual_delivery_cost: string }[]>`select status, actual_delivery_cost from public.orders where id = ${orderId}`;
    expect(o).toEqual({ status: "shipped", actual_delivery_cost: "100.00" });
  });

  test("من بعد موافقة المالك: كتطبّق، والتكلفة الحقيقية 340 كتعوض 100", async () => {
    expect(await store.acknowledgeInvoiceWarnings(invoiceId, ACTOR)).toBe(true);
    expect(await store.acknowledgeInvoiceWarnings(invoiceId, ACTOR)).toBe(false);
    const v = (await store.computeBoard()).orders.find((x) => x.order.id === orderId);
    expect(v?.invoiceWarningPending).toBeFalsy();
    const res = await store.applySettlements({ readyOrderIds: [], approvedOrderIds: [orderId], actor: ACTOR });
    expect(res.applied).toHaveLength(1);
    const [o] = await sql<{ status: string; actual_delivery_cost: string }[]>`select status, actual_delivery_cost from public.orders where id = ${orderId}`;
    expect(o).toEqual({ status: "delivered", actual_delivery_cost: "340.00" });
  });

  test("صفحة «التقارير والأرباح» الموجودة: الطلبية مرة وحدة، بالتكلفة الحقيقية", async () => {
    const r = await reports.getSalesBySource(RANGE, "manual");
    expect(r.totals).toMatchObject({
      deliveredOrders: 1,
      revenueMad: 3300,
      cogsMad: 2797.5,
      deliveryFeesMad: 100,
      deliveryCostRecordedMad: 340,
      deliveryNetMad: -240,
      ordersMissingDeliveryCost: 0,
    });
    // تطبيق ثاني ما كيزيد والو.
    await store.applySettlements({ readyOrderIds: [orderId], approvedOrderIds: [orderId], actor: ACTOR });
    const again = await reports.getSalesBySource(RANGE, "manual");
    expect(again.totals.deliveredOrders).toBe(1);
    expect(again.totals.deliveryCostRecordedMad).toBe(340);
  });

  test("لا Purchase", () => {
    expect(capiSpy).not.toHaveBeenCalled();
    expect(deferredSpy).not.toHaveBeenCalled();
  });
});
