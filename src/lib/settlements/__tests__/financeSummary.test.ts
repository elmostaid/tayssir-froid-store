// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

/**
 * الملخص المالي على قاعدة معزولة، بأرقام محسوبة باليد مسبقاً.
 *
 * كل شيء في شهر بعيد (مارس 2031) حتى لا تختلط أرقامه ببيانات اختبارات أخرى.
 * ما يحرسه: الربح المحقَّق لا يدخله إلا ما هو حقيقي بالكامل، والرجعات خسارة،
 * والمصاريف بشهرها، والبنك بتاريخ وصوله، والمُرسَل بلا فاتورة ليس فلوساً.
 */

vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: vi.fn(), isCapiConfigured: () => true, hashForCapi: (v: string) => v }));
vi.mock("@/lib/pixel/sendDeferredPurchase", () => ({ sendDeferredPurchase: vi.fn() }));

const { extractPdfTextItems } = await import("@/lib/settlements/pdfText");
const { parseBigDeliveryInvoice } = await import("@/lib/settlements/bigDeliveryInvoice");
const store = await import("@/lib/settlements/settlementStore");
const { getFinanceSummary, resolvePeriod, shiftPeriodKey } = await import("@/lib/settlements/financeSummary");
const { buildFakeBigDeliveryPdf } = await import("./fakeBigDeliveryPdf");
type FakeParcel = import("./fakeBigDeliveryPdf").FakeParcel;

const RUN = String(Date.now()).slice(-6);
const ACTOR = "owner-finance@tayssir.local";
const SKU = `FIN-${RUN}`;
const phone = (n: number) => `06${RUN}${String(n).padStart(2, "0")}`;
const code = (s: string) => `BG${RUN}${s}`;
const MARCH = resolvePeriod("2031-03");

let productId = 0;
const orders: Record<string, number> = {};
const invoiceIds: number[] = [];
const expenseIds: number[] = [];

async function seedOrder(
  key: string,
  o: { phone: string; subtotal: number; fee: number; cogs: number | null; status?: string; cartons?: number | null }
) {
  const [row] = await sql<{ id: number }[]>`
    insert into public.orders (
      customer_name, customer_phone, customer_city, items_subtotal, delivery_fee, final_total,
      status, source, idempotency_key, created_at, carton_count, confirmed_at
    ) values (
      'زبون مالية', ${o.phone}, 'فاس', ${o.subtotal}, ${o.fee}, ${o.subtotal + o.fee},
      ${o.status ?? "shipped"}, 'manual', ${`fin-${RUN}-${key}`}, '2031-03-01T10:00:00Z', ${o.cartons ?? null}, now()
    ) returning id
  `;
  await sql`
    insert into public.order_items (
      order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
      unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status
    ) values (${row.id}, ${productId}, null, 'منتج مالية', ${SKU}, ${o.subtotal}, 1, ${o.subtotal}, ${o.cogs}, 'reserved')
  `;
  orders[key] = row.id;
}

async function upload(number: string, date: string, parcels: FakeParcel[]) {
  const pdf = buildFakeBigDeliveryPdf({ number, date, parcels });
  const parsed = parseBigDeliveryInvoice(await extractPdfTextItems(pdf));
  if (!parsed.ok) throw new Error(parsed.problems.join("\n"));
  const r = await store.registerInvoice({
    parsed: parsed.invoice,
    bytes: pdf,
    fileName: `${number}.pdf`,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    actor: ACTOR,
  });
  if (!("invoiceId" in r)) throw new Error("upload failed");
  invoiceIds.push(r.invoiceId);
  return { id: r.invoiceId, invoice: parsed.invoice };
}

async function expense(amount: number, category: string, day: string) {
  const [row] = await sql<{ id: number }[]>`
    insert into public.operating_expenses (amount_mad, category, description, spent_on, created_by)
    values (${amount}, ${category}, 'اختبار مالية', ${day}, ${ACTOR}) returning id
  `;
  expenseIds.push(row.id);
}

let shippedBefore = { count: 0, expectedCents: 0 };
let firstInvoice = 0;
let secondInvoice = 0;

beforeAll(async () => {
  const before = await getFinanceSummary(resolvePeriod("all"));
  shippedBefore = before.cash.shippedNoInvoice;

  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [p] = await sql<{ id: number }[]>`
    insert into public.products (category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
      stock_quantity, min_order_qty, qty_increment, status)
    values (${category.id}, ${SKU}, ${SKU.toLowerCase()}, 'منتج مالية', 'قطعة', 100, 60, 50, 1, 1, 'published')
    returning id
  `;
  productId = p.id;

  // P1: كرطونة واحدة. ربح = 1000 − 600 + 35 − 35 = 400.
  await seedOrder("P1", { phone: phone(1), subtotal: 1000, fee: 35, cogs: 600 });
  // P2: كرطونتان (العدد مسجَّل). ربح = 2000 − 1500 + 70 − (35 + 90) = 445.
  await seedOrder("P2", { phone: phone(2), subtotal: 2000, fee: 70, cogs: 1500, cartons: 2 });
  // P3: رجعات كاملة برسوم 20 ← خسارة 20.
  await seedOrder("P3", { phone: phone(3), subtotal: 465, fee: 35, cogs: 300 });
  // P4: مسلَّمة بفاتورة ولكن ثمن الشراء ما محفوظش ← لا تدخل الربح.
  await seedOrder("P4", { phone: phone(4), subtotal: 300, fee: 35, cogs: null });
  // P5: مُرسَلة بلا فاتورة ← متوقَّعة، ماشي فلوس.
  await seedOrder("P5", { phone: phone(5), subtotal: 765, fee: 35, cogs: 400 });

  const one = await upload(`FIN-${RUN}-1`, "2031-03-10", [
    { code: code("PA"), pickup: "2031-03-03", phone: phone(1), cityLines: ["Fes"], cod: 1035, fee: 35 },
    { code: code("PB"), pickup: "2031-03-03", phone: phone(2), cityLines: ["Fes"], cod: 1000, fee: 35 },
    { code: code("PC"), pickup: "2031-03-03", phone: phone(2), cityLines: ["Fes"], cod: 1070, fee: 90 },
    { code: code("PD"), pickup: "2031-03-03", phone: phone(3), cityLines: ["Fes"], status: "Retourné", cod: 0, fee: 20 },
  ]);
  firstInvoice = one.id;
  const two = await upload(`FIN-${RUN}-2`, "2031-03-20", [
    { code: code("PE"), pickup: "2031-03-04", phone: phone(4), cityLines: ["Fes"], cod: 335, fee: 35 },
  ]);
  secondInvoice = two.id;

  const res = await store.applySettlements({
    readyOrderIds: [orders.P1, orders.P2, orders.P4],
    approvedOrderIds: [orders.P1, orders.P4],
    returnOrderIds: [orders.P3],
    actor: ACTOR,
  });
  if (res.applied.length !== 4) throw new Error(`applied ${res.applied.length}: ${JSON.stringify(res.skipped)}`);

  // صافي الفاتورة 1 = 3105 − 180 = 2925. وصل 2915 فقط (فرق 10) يوم 15 مارس.
  await store.markInvoiceBankReceived(firstInvoice, 291500, ACTOR, "2031-03-15");

  await expense(300, "advertising", "2031-03-05");
  await expense(100, "rent", "2031-03-06");
  await expense(999, "advertising", "2031-04-02");
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
  await sql`delete from public.operating_expenses where id = any(${expenseIds})`;
});

describe("الملخص المالي", () => {
  test("المدة: شهر كامل بحدود UTC، والتنقل بين الشهور", () => {
    expect(MARCH).toMatchObject({ key: "2031-03", from: "2031-03-01", to: "2031-04-01", label: "مارس 2031" });
    expect(resolvePeriod("2031-12")).toMatchObject({ from: "2031-12-01", to: "2032-01-01" });
    expect(resolvePeriod("all")).toMatchObject({ from: null, to: null });
    expect(resolvePeriod("garbage", new Date("2026-11-27T10:00:00Z")).key).toBe("2026-11");
    expect(shiftPeriodKey("2031-01", -1)).toBe("2030-12");
    expect(shiftPeriodKey("2031-12", 1)).toBe("2032-01");
  });

  test("الربح المحقَّق = الطلبيات الحقيقية بالكامل فقط (400 + 445)", async () => {
    const f = await getFinanceSummary(MARCH);
    const mine = f.realized.orders.filter((o) => Object.values(orders).includes(o.orderId));
    expect(mine.map((o) => [o.orderId, o.profitCents]).sort()).toEqual(
      [
        [orders.P1, 40000],
        [orders.P2, 44500],
      ].sort()
    );
    expect(f.realized.orders).toHaveLength(2);
    expect(f.realized).toMatchObject({
      salesCents: 300000,
      cogsCents: 210000,
      deliveryChargedCents: 10500,
      deliveryRealCents: 16000,
      collectedCents: 310500,
      profitCents: 84500,
    });
    // P2 تكلفتها الحقيقية مجموع الكرطونتين.
    expect(mine.find((o) => o.orderId === orders.P2)).toMatchObject({ deliveryRealCents: 12500, invoiceDate: "2031-03-10" });
  });

  test("طلبية بثمن شراء غير محفوظ ما كتدخلش وكتبان بسببها", async () => {
    const f = await getFinanceSummary(MARCH);
    expect(f.realized.excluded).toEqual([
      expect.objectContaining({ orderId: orders.P4, reason: expect.stringMatching(/ماشي محفوظ/) }),
    ]);
  });

  test("الرجعة خسارة بقيمة رسومها، والحالة ما تبدلاتش", async () => {
    const f = await getFinanceSummary(MARCH);
    expect(f.returns.lossCents).toBe(2000);
    expect(f.returns.items).toEqual([
      expect.objectContaining({ orderId: orders.P3, lossCents: 2000, statusChanged: false }),
    ]);
  });

  test("المصاريف بشهرها فقط، والصافي = 845 − 20 − 400 = 425", async () => {
    const f = await getFinanceSummary(MARCH);
    expect(f.expenses).toMatchObject({ totalCents: 40000, advertisingCents: 30000 });
    expect(f.netCents).toBe(42500);

    const april = await getFinanceSummary(resolvePeriod("2031-04"));
    expect(april.realized.orders).toHaveLength(0);
    expect(april.expenses.advertisingCents).toBe(99900);
    expect(april.netCents).toBe(-99900);
  });

  test("البنك بتاريخ الوصول، والفرق مع صافي الفاتورة كيبان", async () => {
    const march = await getFinanceSummary(MARCH);
    expect(march.cash).toMatchObject({ bankReceivedCents: 291500, bankReceivedInvoices: 1 });
    expect(march.cash.bankDifferences).toContainEqual({
      id: firstInvoice,
      number: `FIN-${RUN}-1`,
      netCents: 292500,
      receivedCents: 291500,
    });
    const april = await getFinanceSummary(resolvePeriod("2031-04"));
    expect(april.cash.bankReceivedCents).toBe(0);
  });

  test("عند شركات التوصيل = الفواتير الفعّالة اللي ما وصلاتش (رصيد اليوم)", async () => {
    const f = await getFinanceSummary(MARCH);
    const ids = f.cash.owedInvoices.map((i) => i.id);
    expect(ids).toContain(secondInvoice);
    expect(ids).not.toContain(firstInvoice);
    // صافي الفاتورة 2 = 335 − 35 = 300.
    expect(f.cash.owedInvoices.find((i) => i.id === secondInvoice)?.netCents).toBe(30000);
  });

  test("المُرسَلة بلا فاتورة متوقَّعة فقط: P5 وحدها تزيد (والرجعة P3 ماشي منها)", async () => {
    const f = await getFinanceSummary(resolvePeriod("all"));
    expect(f.cash.shippedNoInvoice.count - shippedBefore.count).toBe(1);
    expect(f.cash.shippedNoInvoice.expectedCents - shippedBefore.expectedCents).toBe(80000);
  });

  test("الربح كيتقسم: فلوسو وصلات للبنك / مازال عند الشركة", async () => {
    const received = await getFinanceSummary(MARCH);
    expect(received.realized).toMatchObject({ bankedProfitCents: 84500, pendingProfitCents: 0 });
    expect(received.realized.orders.every((o) => o.banked)).toBe(true);

    // نلغي تسجيل البنك: نفس الربح، ولكن كامل كيولي «مازال عند الشركة».
    await store.markInvoiceBankReceived(firstInvoice, null, ACTOR);
    const pending = await getFinanceSummary(MARCH);
    expect(pending.realized).toMatchObject({ profitCents: 84500, bankedProfitCents: 0, pendingProfitCents: 84500 });
    expect(pending.cash.bankReceivedCents).toBe(0);

    await store.markInvoiceBankReceived(firstInvoice, 291500, ACTOR, "2031-03-15");
    expect((await getFinanceSummary(MARCH)).realized.bankedProfitCents).toBe(84500);
  });

  test("التراجع عن الفاتورة 1 كيحيّد ربحها ورجعتها من الملخص", async () => {
    const r = await store.rollbackInvoice(firstInvoice, ACTOR);
    expect(r.ok).toBe(true);
    const f = await getFinanceSummary(MARCH);
    expect(f.realized.orders).toHaveLength(0);
    expect(f.returns.items).toHaveLength(0);
    expect(f.cash.bankReceivedCents).toBe(0);
    expect(f.netCents).toBe(-40000);
  });
});
