import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: vi.fn() }));

const { createOrder } = await import("@/lib/orders/createOrder");

// اختبار تكامل حقيقي مقابل قاعدة بيانات حية (محلية أو حاوية CI): يثبت أن
// الثمن المحفوظ فعلاً في order_items هو ثمن المستوى الصحيح، وأنه يُحسب من
// قاعدة البيانات وحدها — المتصفح لا يرسل أي ثمن أصلاً.
//
// المنتج المرجعي هو حالة "منتري صابون 6 خيوط" المطلوبة للاختبار على Preview:
// min_order_qty = 1، و 1–9 = 20 / 10–49 = 13 / 50+ = 12.

const TIERED_SKU = "TEST-TIER-001";
const SINGLE_SKU = "TEST-TIER-SINGLE-001";

const TEST_PHONE_PREFIX = "061111";
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `${TEST_PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`;
}

function customer() {
  return {
    fullName: "زبون اختبار التسعير",
    phone: nextPhone(),
    city: "مراكش",
    address: "حي المحاميد، شارع تجريبي",
    notes: null,
  };
}

async function productIdBySku(sku: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`select id from public.products where sku = ${sku}`;
  return row.id;
}

/** يطلب كمية معيّنة ويُرجع سطر الطلب كما حُفظ فعلاً في قاعدة البيانات. */
async function orderQuantity(sku: string, quantity: number) {
  const result = await createOrder({
    items: [{ productId: await productIdBySku(sku), variantId: null, quantity }],
    customer: customer(),
    idempotencyKey: randomUUID(),
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("فشل إنشاء الطلب");

  const [line] = await sql<{ unit_price_snapshot: string; line_total: string; quantity: number }[]>`
    select oi.unit_price_snapshot, oi.line_total, oi.quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.public_reference = ${result.publicReference}
  `;
  return {
    unitPrice: Number(line.unit_price_snapshot),
    lineTotal: Number(line.line_total),
    quantity: line.quantity,
    reference: result.publicReference,
  };
}

let originalMinOrderAmount: unknown = null;

beforeAll(async () => {
  // هذه الاختبارات تتعمّد كميات صغيرة (1 و9 قطع) لفحص حدود المستويات، وهي
  // أقل من الحد الأدنى الحقيقي للطلب (1000 درهم). نُصفّره مؤقتاً هنا ونعيده
  // كما كان في afterAll — آمن لأن ملفات الاختبار تعمل تباعاً لا بالتوازي
  // (fileParallelism: false في vitest.config.mts).
  const [row] = await sql<{ value: unknown }[]>`
    select value from public.settings where key = 'min_order_amount_mad'
  `;
  originalMinOrderAmount = row?.value ?? null;
  await sql`update public.settings set value = to_jsonb(0) where key = 'min_order_amount_mad'`;

  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;

  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status,
      pricing_mode, tier2_min_qty, tier2_price, tier3_min_qty, tier3_price
    ) values (
      ${TIERED_SKU}, 'test-tier-001', ${category.id}, 'منتري اختبار 6 خيوط', 'قطعة',
      1, 1, 8.00, 20.00, 5000, 'published',
      'three_tier', 10, 13.00, 50, 12.00
    )
    on conflict (sku) do nothing
  `;

  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      ${SINGLE_SKU}, 'test-tier-single-001', ${category.id}, 'منتج بثمن واحد', 'قطعة',
      1, 1, 90.00, 150.00, 5000, 'published'
    )
    on conflict (sku) do nothing
  `;
});

afterAll(async () => {
  if (originalMinOrderAmount !== null) {
    await sql`
      update public.settings set value = ${sql.json(originalMinOrderAmount as never)}
      where key = 'min_order_amount_mad'
    `;
  }

  // ترتيب الحذف مهم: order_items تشير إلى المنتجات، وstock_movements كذلك.
  const ids = await sql<{ id: number }[]>`
    select id from public.products where sku in (${TIERED_SKU}, ${SINGLE_SKU})
  `;
  const productIds = ids.map((row) => row.id);
  if (productIds.length > 0) {
    const orderIds = await sql<{ order_id: number }[]>`
      select distinct order_id from public.order_items where product_id = any(${productIds})
    `;
    const ids2 = orderIds.map((row) => row.order_id);
    if (ids2.length > 0) {
      await sql`delete from public.stock_movements where order_id = any(${ids2})`;
      await sql`delete from public.order_items where order_id = any(${ids2})`;
      await sql`delete from public.order_status_history where order_id = any(${ids2})`;
      await sql`delete from public.orders where id = any(${ids2})`;
    }
    await sql`delete from public.stock_movements where product_id = any(${productIds})`;
    await sql`delete from public.products where id = any(${productIds})`;
  }
  await sql.end({ timeout: 5 });
});

describe("createOrder — الخادم يحفظ ثمن المستوى الصحيح (1/9/10/49/50/51)", () => {
  test.each([
    [1, 20, 20],
    [9, 20, 180],
    [10, 13, 130],
    [49, 13, 637],
    [50, 12, 600],
    [51, 12, 612],
  ])("كمية %i ⇒ unit_price_snapshot=%i، line_total=%i", async (quantity, unit, total) => {
    const line = await orderQuantity(TIERED_SKU, quantity);
    expect(line.quantity).toBe(quantity);
    expect(line.unitPrice).toBe(unit);
    expect(line.lineTotal).toBe(total);
  });

  test("الثمن يُطبَّق على كل الوحدات لا على الزائد فقط (50 ⇒ 600 لا 649)", async () => {
    const line = await orderQuantity(TIERED_SKU, 50);
    expect(line.lineTotal).toBe(600);
  });

  test("items_subtotal في الطلب يطابق مجموع الأسطر", async () => {
    const line = await orderQuantity(TIERED_SKU, 10);
    const [order] = await sql<{ items_subtotal: string }[]>`
      select items_subtotal from public.orders where public_reference = ${line.reference}
    `;
    expect(Number(order.items_subtotal)).toBe(130);
  });
});

describe("createOrder — منتج بثمن واحد يبقى بثمن واحد", () => {
  test.each([1, 9, 10, 50])("كمية %i تبقى بثمن 150 درهم للوحدة", async (quantity) => {
    const line = await orderQuantity(SINGLE_SKU, quantity);
    expect(line.unitPrice).toBe(150);
    expect(line.lineTotal).toBe(150 * quantity);
  });
});

describe("الطلبات القديمة مجمَّدة: تغيير ثمن المنتج لاحقاً لا يمسّها", () => {
  test("طلب محفوظ يحتفظ بثمنه الأصلي بعد تعديل كل مستويات المنتج", async () => {
    const line = await orderQuantity(TIERED_SKU, 10);
    expect(line.unitPrice).toBe(13);

    // نغيّر سلَّم الأثمنة بالكامل بعد حفظ الطلب
    await sql`
      update public.products
      set sale_price = 99.00, tier2_price = 88.00, tier3_price = 77.00
      where sku = ${TIERED_SKU}
    `;

    const [after] = await sql<{ unit_price_snapshot: string; line_total: string }[]>`
      select oi.unit_price_snapshot, oi.line_total
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.public_reference = ${line.reference}
    `;
    expect(Number(after.unit_price_snapshot)).toBe(13);
    expect(Number(after.line_total)).toBe(130);

    // نُرجع الأثمنة الأصلية حتى لا تتأثر بقية الاختبارات
    await sql`
      update public.products
      set sale_price = 20.00, tier2_price = 13.00, tier3_price = 12.00
      where sku = ${TIERED_SKU}
    `;
  });
});

describe("الخادم لا يثق بأي ثمن قادم من المتصفح", () => {
  test("إرسال ثمن مزيَّف مع السطر لا يؤثر إطلاقاً على الثمن المحفوظ", async () => {
    const productId = await productIdBySku(TIERED_SKU);
    const result = await createOrder({
      // حقول إضافية مدسوسة عمداً — CartItemInput لا يحتوي unitPrice أصلاً،
      // وcreateOrder يعيد الجلب من قاعدة البيانات دائماً.
      items: [
        { productId, variantId: null, quantity: 10, unitPrice: 1, lineTotal: 10 } as never,
      ],
      customer: customer(),
      idempotencyKey: randomUUID(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [line] = await sql<{ unit_price_snapshot: string; line_total: string }[]>`
      select oi.unit_price_snapshot, oi.line_total
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.public_reference = ${result.publicReference}
    `;
    expect(Number(line.unit_price_snapshot)).toBe(13);
    expect(Number(line.line_total)).toBe(130);
  });
});
