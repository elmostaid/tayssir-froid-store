// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

/**
 * المسار الكامل على قاعدة معزولة: PDF وهمي ← قراءة ← تسجيل ← مطابقة ← تطبيق
 * ← فاتورة ثانية تُكمل طلبية موزَّعة ← تكرار الرفع ← تراجع ← إعادة تطبيق.
 *
 * ما تحرسه هذه الاختبارات فوق كل شيء:
 * - لا Purchase يخرج إلى Meta (المرسِلان مُتجسَّس عليهما ويجب ألا يُستدعيا).
 * - المخزون والأثمنة وسطور الطلبية لا تتغيّر أبداً.
 * - التراجع يُرجع ما كتبناه فقط، ولا يكتب فوق تعديل لاحق.
 */

const capiSpy = vi.fn();
const deferredSpy = vi.fn();
vi.mock("@/lib/pixel/capi", () => ({
  sendCapiEvent: capiSpy,
  isCapiConfigured: () => true,
  hashForCapi: (v: string) => v,
}));
vi.mock("@/lib/pixel/sendDeferredPurchase", () => ({ sendDeferredPurchase: deferredSpy }));

const { extractPdfTextItems } = await import("@/lib/settlements/pdfText");
const { parseBigDeliveryInvoice } = await import("@/lib/settlements/bigDeliveryInvoice");
const store = await import("@/lib/settlements/settlementStore");
const { buildFakeBigDeliveryPdf } = await import("./fakeBigDeliveryPdf");
type FakeParcel = import("./fakeBigDeliveryPdf").FakeParcel;

const RUN = String(Date.now()).slice(-6);
const ACTOR = "owner-test@tayssir.local";
const SKU = `SETTLE-${RUN}`;
const phone = (n: number) => `07${RUN}${String(n).padStart(2, "0")}`;
const code = (s: string) => `BG${RUN}${s}`;

let productId = 0;
const orders: Record<string, number> = {};
const invoiceIds: number[] = [];

async function seedOrder(
  key: string,
  opts: { phone: string; city: string; total: number; fee?: number; status?: string; cost?: number | null; createdAt?: string; cartons?: number | null }
) {
  const fee = opts.fee ?? 35;
  const subtotal = opts.total - fee;
  const [row] = await sql<{ id: number }[]>`
    insert into public.orders (
      customer_name, customer_phone, customer_city, items_subtotal, delivery_fee, final_total,
      status, source, idempotency_key, actual_delivery_cost, created_at, carton_count, confirmed_at
    ) values (
      'زبون تسوية', ${opts.phone}, ${opts.city}, ${subtotal}, ${fee}, ${opts.total},
      ${opts.status ?? "shipped"}, 'manual', ${`settle-${RUN}-${key}`}, ${opts.cost ?? null},
      ${opts.createdAt ?? "2026-11-10T10:00:00Z"}, ${opts.cartons ?? null}, now()
    ) returning id
  `;
  await sql`
    insert into public.order_items (
      order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
      unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status
    ) values (${row.id}, ${productId}, null, 'منتج تسوية', ${SKU}, ${subtotal}, 1, ${subtotal}, ${Math.round(subtotal * 0.6)}, 'reserved')
  `;
  orders[key] = row.id;
  return row.id;
}

async function upload(number: string, parcels: FakeParcel[], extra: Parameters<typeof buildFakeBigDeliveryPdf>[0] extends infer O ? Partial<O> : never = {}) {
  const pdf = buildFakeBigDeliveryPdf({ number, parcels, ...extra });
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
  return { r, pdf, parsed: parsed.invoice };
}

async function orderState(id: number) {
  const [o] = await sql<{ status: string; actual_delivery_cost: string | null; final_total: string; items_subtotal: string; delivery_fee: string }[]>`
    select status, actual_delivery_cost, final_total, items_subtotal, delivery_fee from public.orders where id = ${id}
  `;
  return o;
}

async function verdictFor(id: number) {
  const board = await store.computeBoard();
  return board.orders.find((v) => v.order.id === id) ?? null;
}

async function stock() {
  const [p] = await sql<{ stock_quantity: number }[]>`select stock_quantity from public.products where id = ${productId}`;
  return p.stock_quantity;
}

let snapshotOrderIds: number[] = [];
async function itemsSnapshot() {
  // نفس الطلبيات في اللقطتين (قبل/بعد): طلبية أُضيفت لاحقاً في اختبار آخر لا تُقارَن.
  return sql`
    select order_id, unit_price_snapshot, quantity, line_total, purchase_price_snapshot, line_status
    from public.order_items where order_id = any(${snapshotOrderIds}) order by order_id, id
  `;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [p] = await sql<{ id: number }[]>`
    insert into public.products (category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
      stock_quantity, min_order_qty, qty_increment, status)
    values (${category.id}, ${SKU}, ${SKU.toLowerCase()}, 'منتج تسوية', 'قطعة', 100, 60, 50, 1, 1, 'published')
    returning id
  `;
  productId = p.id;

  // A: كرطونة واحدة. B: كرطونتان في الفاتورة 1 وواحدة في الفاتورة 2 (0457).
  // C: تكلفة يدوية مختلفة (0440). D: كرطونة راجعة. E: 6 كرطونات × 718 بعدد مسجَّل.
  await seedOrder("A", { phone: phone(1), city: "تاهلة", total: 635 });
  await seedOrder("B", { phone: phone(2), city: "طرفاية", total: 2110, fee: 45 });
  await seedOrder("C", { phone: phone(3), city: "سطيحات", total: 1400, fee: 70, cost: 20 });
  await seedOrder("D", { phone: phone(4), city: "فاس", total: 500 });
  await seedOrder("E", { phone: phone(5), city: "Fes", total: 4308, cartons: 6 });
  // F: تُسوّى بالفاتورة 2 الأحدث وحدها — التراجع عن الفاتورة 1 لا يجوز أن يمسّها.
  await seedOrder("F", { phone: phone(6), city: "ارفود", total: 931 });
});

afterAll(async () => {
  const ids = Object.values(orders);
  await sql`delete from public.carrier_settlement_changes where order_id = any(${ids})`;
  await sql`update public.carrier_parcels set settlement_id = null where invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_order_settlements where order_id = any(${ids}) or invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_parcels where invoice_id = any(${invoiceIds})`;
  await sql`delete from public.carrier_invoices where id = any(${invoiceIds})`;
  await sql`delete from public.orders where id = any(${ids})`;
  await sql`delete from public.products where id = ${productId}`;
});

const invoice1: FakeParcel[] = [
  { code: code("A1"), pickup: "2026-11-14", phone: phone(1), cityLines: ["Tahla"], cod: 635, fee: 35 },
  { code: code("B1"), pickup: "2026-11-17", phone: phone(2), cityLines: ["Tarfaya"], cod: 755, fee: 35 },
  { code: code("B2"), pickup: "2026-11-17", phone: phone(2), cityLines: ["Tarfaya"], cod: 1075, fee: 35 },
  { code: code("C1"), pickup: "2026-11-14", phone: phone(3), cityLines: ["Stehat"], cod: 700, fee: 35 },
  { code: code("C2"), pickup: "2026-11-14", phone: phone(3), cityLines: ["Stehat"], cod: 700, fee: 90 },
  { code: code("D1"), pickup: "2026-11-15", phone: phone(4), status: "Retourné", cityLines: ["Fes"], cod: 0, fee: 20 },
  // 6 كرطونات على صفحات متعددة (rowsPerPage = 4).
  ...Array.from({ length: 6 }, (_, i) => ({
    code: code(`E${i + 1}`), pickup: "2026-11-16", phone: phone(5), cityLines: ["Fes"], cod: 718, fee: 35,
  })),
];

describe("تسوية فواتير التوصيل — المسار الكامل على قاعدة معزولة", () => {
  let stockBefore = 0;
  let itemsBefore: unknown;

  test("فاتورة 1 متعددة الصفحات: التسجيل لا يغيّر أي طلبية، والمطابقة تفرز الحالات", async () => {
    stockBefore = await stock();
    snapshotOrderIds = Object.values(orders);
    itemsBefore = await itemsSnapshot();
    const { r, parsed } = await upload(`FCT-${RUN}-1`, invoice1, { rowsPerPage: 4 });
    expect(parsed.pageCount).toBeGreaterThan(1);
    expect(r.kind).toBe("created");

    for (const key of ["A", "B", "C", "D", "E"]) expect((await orderState(orders[key])).status).toBe("shipped");

    expect(await verdictFor(orders.A)).toMatchObject({ kind: "ready", confidence: "medium" });
    expect(await verdictFor(orders.B)).toMatchObject({ kind: "waiting", missingCents: 28000 });
    expect(await verdictFor(orders.C)).toMatchObject({ kind: "decide", costConflict: true, feeCents: 12500 });
    expect(await verdictFor(orders.D)).toMatchObject({ kind: "blocked" });
    expect(await verdictFor(orders.E)).toMatchObject({ kind: "ready", confidence: "high", feeCents: 21000 });
  });

  test("الموافقة الجماعية تطبّق الجاهزة فقط — لا المحجوبة ولا التي تحتاج قراراً", async () => {
    const res = await store.applySettlements({
      readyOrderIds: [orders.A, orders.E, orders.C, orders.D, orders.B],
      approvedOrderIds: [],
      actor: ACTOR,
    });
    expect(res.applied.map((a) => a.orderId).sort()).toEqual([orders.A, orders.E].sort());
    expect(res.skipped.map((s) => s.orderId).sort()).toEqual([orders.B, orders.C, orders.D].sort());

    expect(await orderState(orders.A)).toMatchObject({ status: "delivered", actual_delivery_cost: "35.00" });
    expect(await orderState(orders.E)).toMatchObject({ status: "delivered", actual_delivery_cost: "210.00" });
    expect(await orderState(orders.C)).toMatchObject({ status: "shipped", actual_delivery_cost: "20.00" });
    expect(await orderState(orders.D)).toMatchObject({ status: "shipped", actual_delivery_cost: null });

    const history = await sql<{ status: string; note: string; changed_by: string }[]>`
      select status, note, changed_by from public.order_status_history where order_id = ${orders.A}
    `;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "delivered", changed_by: ACTOR });
    expect(history[0].note).toMatch(`FCT-${RUN}-1`);

    const changes = await sql`select field, old_value, new_value from public.carrier_settlement_changes where order_id = ${orders.A} order by id`;
    expect(changes).toEqual([
      { field: "status", old_value: "shipped", new_value: "delivered" },
      { field: "actual_delivery_cost", old_value: null, new_value: "35.00" },
    ]);
  });

  test("تطبيق ثانٍ لنفس الطلبيات لا يفعل شيئاً (لا تسوية مزدوجة)", async () => {
    const res = await store.applySettlements({ readyOrderIds: [orders.A], approvedOrderIds: [], actor: ACTOR });
    expect(res.applied).toHaveLength(0);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.carrier_order_settlements where order_id = ${orders.A}
    `;
    expect(n).toBe(1);
  });

  test("الموافقة الصريحة على تعارض التكلفة تستبدلها، والقيمة اليدوية محفوظة في السجل", async () => {
    const res = await store.applySettlements({ readyOrderIds: [], approvedOrderIds: [orders.C], actor: ACTOR });
    expect(res.applied).toHaveLength(1);
    expect(await orderState(orders.C)).toMatchObject({ status: "delivered", actual_delivery_cost: "125.00" });
    const [c] = await sql`select old_value, new_value from public.carrier_settlement_changes where order_id = ${orders.C} and field = 'actual_delivery_cost'`;
    expect(c).toEqual({ old_value: "20.00", new_value: "125.00" });
  });

  test("الكرطونة الراجعة لا تُطبَّق حتى لو طُلبت صراحةً", async () => {
    const res = await store.applySettlements({ readyOrderIds: [], approvedOrderIds: [orders.D], actor: ACTOR });
    expect(res.applied).toHaveLength(0);
    expect((await orderState(orders.D)).status).toBe("shipped");
  });

  test("إعادة رفع نفس الملف لا تُسجّل شيئاً جديداً", async () => {
    const { r } = await upload(`FCT-${RUN}-1`, invoice1, { rowsPerPage: 4 });
    expect(r.kind).toBe("already_active");
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.carrier_invoices where invoice_number = ${`FCT-${RUN}-1`}
    `;
    expect(n).toBe(1);
  });

  test("نفس رقم الفاتورة بملف مختلف يُرفض", async () => {
    const { r } = await upload(`FCT-${RUN}-1`, invoice1.slice(0, 3));
    expect(r.kind).toBe("number_conflict");
  });

  test("كرطونة سبق احتسابها في فاتورة أخرى لا تُحتسب مرتين (بنفس المبلغ أو بمبلغ مختلف)", async () => {
    const { r } = await upload(`FCT-${RUN}-DUP`, [
      { ...invoice1[0] },
      { ...invoice1[1], cod: 999, fee: 35 },
    ]);
    expect(r.kind).toBe("created");
    if (r.kind !== "created") return;
    expect(r.duplicates).toBe(1);
    expect(r.conflicts).toHaveLength(1);
    const rows = await sql<{ active: boolean; skip_reason: string | null }[]>`
      select active, skip_reason from public.carrier_parcels where invoice_id = ${r.invoiceId} order by line_no
    `;
    expect(rows).toEqual([
      { active: false, skip_reason: "duplicate" },
      { active: false, skip_reason: "duplicate_conflict" },
    ]);
    // ولا تغيّر شيئاً في الحساب: B ما زالت تنتظر 280.
    expect(await verdictFor(orders.B)).toMatchObject({ kind: "waiting", missingCents: 28000 });
  });

  test("فاتورة 2 تحمل الكرطونة الباقية: الطلبية الموزعة تكتمل بمجموع رسوم الفاتورتين", async () => {
    await upload(`FCT-${RUN}-2`, [
      { code: code("B3"), pickup: "2026-11-20", phone: phone(2), cityLines: ["Tarfaya"], cod: 280, fee: 35 },
      { code: code("F1"), pickup: "2026-11-20", phone: phone(6), cityLines: ["Erfoud"], cod: 931, fee: 40 },
    ]);
    const v = await verdictFor(orders.B);
    expect(v).toMatchObject({ kind: "ready", codCents: 211000, feeCents: 10500 });
    expect(new Set(v!.parcels.map((p) => p.invoiceNumber))).toEqual(new Set([`FCT-${RUN}-1`, `FCT-${RUN}-2`]));

    const res = await store.applySettlements({ readyOrderIds: [orders.B, orders.F], approvedOrderIds: [], actor: ACTOR });
    expect(res.applied).toHaveLength(2);
    expect(await orderState(orders.B)).toMatchObject({ status: "delivered", actual_delivery_cost: "105.00" });
    expect(await orderState(orders.F)).toMatchObject({ status: "delivered", actual_delivery_cost: "40.00" });
  });

  test("التراجع عن الفاتورة 1 يعكس كل ما بُني عليها — ومنها B التي اكتملت بالفاتورة 2", async () => {
    // تعديل لاحق يدوي على E: التراجع يجب ألا يكتب فوقه.
    await sql`update public.orders set actual_delivery_cost = 199 where id = ${orders.E}`;

    const inv1 = invoiceIds[0];
    const r = await store.rollbackInvoice(inv1, ACTOR);
    expect(r.ok).toBe(true);
    expect(r.revertedOrders).toHaveLength(4); // A, B, C, E

    expect(await orderState(orders.A)).toMatchObject({ status: "shipped", actual_delivery_cost: null });
    expect(await orderState(orders.B)).toMatchObject({ status: "shipped", actual_delivery_cost: null });
    expect(await orderState(orders.C)).toMatchObject({ status: "shipped", actual_delivery_cost: "20.00" });
    // الحالة رجعت، والتكلفة التي عدّلها المالك بعدنا بقيت.
    expect(await orderState(orders.E)).toMatchObject({ status: "shipped", actual_delivery_cost: "199.00" });
    expect(r.kept.map((k) => k.detail).join()).toMatch(/تكلفة التوصيل تبدلات/);

    // F سُوّيت بالفاتورة 2 الأحدث وحدها: لا حالتها ولا تكلفتها ولا تسويتها تتأثر.
    expect(await orderState(orders.F)).toMatchObject({ status: "delivered", actual_delivery_cost: "40.00" });
    const [fSettlement] = await sql<{ reverted_at: Date | null }[]>`
      select reverted_at from public.carrier_order_settlements where order_id = ${orders.F}
    `;
    expect(fSettlement.reverted_at).toBeNull();
    const [{ n: fHist }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.order_status_history where order_id = ${orders.F}
    `;
    expect(fHist).toBe(1);

    // كرطونة الفاتورة 2 عادت مفتوحة، فـB تنتظر من جديد 1,830 الناقصة.
    expect(await verdictFor(orders.B)).toMatchObject({ kind: "waiting", missingCents: 183000 });

    // كرطونة A1 كانت «مكررة» في فاتورة DUP؛ بعد سقوط الفاتورة 1 تُحتسَب من DUP،
    // أما B1 بمبلغ مختلف («تعارض») فتبقى خارج الحساب.
    const dup = await sql<{ tracking_code: string; active: boolean; skip_reason: string | null }[]>`
      select p.tracking_code, p.active, p.skip_reason from public.carrier_parcels p
      join public.carrier_invoices i on i.id = p.invoice_id
      where i.invoice_number = ${`FCT-${RUN}-DUP`} order by p.line_no
    `;
    expect(dup).toEqual([
      { tracking_code: code("A1"), active: true, skip_reason: null },
      { tracking_code: code("B1"), active: false, skip_reason: "duplicate_conflict" },
    ]);
    expect(await verdictFor(orders.A)).toMatchObject({ kind: "ready" });

    // سجل الحالات يحمل التراجع ولا يُمحى منه شيء.
    const hist = await sql<{ status: string }[]>`
      select status from public.order_status_history where order_id = ${orders.A} order by id
    `;
    expect(hist.map((h) => h.status)).toEqual(["delivered", "shipped"]);

    const again = await store.rollbackInvoice(inv1, ACTOR);
    expect(again.ok).toBe(false);
  });

  test("تراجع لا يعكس حالة غيّرها المالك بعدنا", async () => {
    // A صارت جاهزة من كرطونة فاتورة DUP؛ نطبّقها، ثم يغيّر المالك حالتها، ثم نتراجع عن DUP.
    await store.applySettlements({ readyOrderIds: [orders.A], approvedOrderIds: [], actor: ACTOR });
    expect((await orderState(orders.A)).status).toBe("delivered");
    await sql`update public.orders set status = 'returned' where id = ${orders.A}`;
    const [dupInvoice] = await sql<{ id: number }[]>`
      select id from public.carrier_invoices where invoice_number = ${`FCT-${RUN}-DUP`}
    `;
    const rb = await store.rollbackInvoice(dupInvoice.id, ACTOR);
    expect((await orderState(orders.A)).status).toBe("returned");
    expect(rb.kept.map((k) => k.detail).join()).toMatch(/returned/);
    await sql`update public.orders set status = 'shipped', actual_delivery_cost = null where id = ${orders.A}`;
  });

  test("إعادة رفع فاتورة متراجَع عنها تعيد تفعيلها وتصير الطلبيات جاهزة من جديد", async () => {
    const { r } = await upload(`FCT-${RUN}-1`, invoice1, { rowsPerPage: 4 });
    expect(r.kind).toBe("reactivated");
    expect(await verdictFor(orders.B)).toMatchObject({ kind: "ready", feeCents: 10500 });
    expect(await verdictFor(orders.A)).toMatchObject({ kind: "ready" });
  });

  test("ضغطتان متزامنتان على «طبّق» (ضغط مزدوج أو إعادة بعد انقطاع) ⇒ تسوية واحدة فقط", async () => {
    await seedOrder("G", { phone: phone(7), city: "ارفود", total: 931 });
    await upload(`FCT-${RUN}-G`, [
      { code: code("G1"), pickup: "2026-11-21", phone: phone(7), cityLines: ["Erfoud"], cod: 931, fee: 35 },
    ]);
    const [a, b] = await Promise.all([
      store.applySettlements({ readyOrderIds: [orders.G], approvedOrderIds: [], actor: ACTOR }),
      store.applySettlements({ readyOrderIds: [orders.G], approvedOrderIds: [], actor: ACTOR }),
    ]);
    expect(a.applied.length + b.applied.length).toBe(1);
    expect(a.skipped.length + b.skipped.length).toBe(1);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.carrier_order_settlements where order_id = ${orders.G}
    `;
    expect(n).toBe(1);
    const hist = await sql`select 1 from public.order_status_history where order_id = ${orders.G}`;
    expect(hist).toHaveLength(1);
    expect(await orderState(orders.G)).toMatchObject({ status: "delivered", actual_delivery_cost: "35.00" });
  });

  test("لا Purchase، ولا مخزون، ولا أثمنة تغيّرت طوال المسار", async () => {
    expect(capiSpy).not.toHaveBeenCalled();
    expect(deferredSpy).not.toHaveBeenCalled();
    expect(await stock()).toBe(stockBefore);
    expect(await itemsSnapshot()).toEqual(itemsBefore);
    for (const key of ["A", "B", "C", "D", "E", "F", "G"]) {
      const o = await orderState(orders[key]);
      expect(Number(o.items_subtotal) + Number(o.delivery_fee)).toBe(Number(o.final_total));
    }
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.orders where id = any(${Object.values(orders)}) and meta_purchase_sent_at is not null
    `;
    expect(n).toBe(0);
  });
});
