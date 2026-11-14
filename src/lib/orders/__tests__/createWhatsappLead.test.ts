import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

// نتجسّس على Meta Conversions API لإثبات أن هذا المسار لا يستدعيها إطلاقاً
// — لا أن الدالة الحقيقية "لا تفعل شيئاً" في بيئة الاختبار (نفس تحفّظ
// createOrder.test.ts). لو استُدعيت مرة واحدة هنا فهذا خلل: طلب واتساب من
// السلة ليس بيعاً مكتملاً بعد.
const sendCapiEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));

const { createWhatsappLead } = await import("@/lib/orders/createWhatsappLead");

// اختبار تكامل حقيقي على قاعدة بيانات حية — نفس منهج createOrder.test.ts:
// نصف ما نتحقّق منه هنا يقع في القاعدة نفسها (قيد unique على
// idempotency_key، ON CONFLICT DO NOTHING)، لا في الكود وحده.

let fixtureProductId: number;
let secondFixtureProductId: number;
const createdIdempotencyKeys: string[] = [];

function nextIdempotencyKey(): string {
  const key = randomUUID().replace(/-/g, "");
  createdIdempotencyKeys.push(key);
  return key;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;

  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values
    (
      'TEST-WA-LEAD-001', 'test-wa-lead-001', ${category.id}, 'منتج اختبار طلب واتساب 1',
      'قطعة', 1, 1, 8.00, 18.00, 120, 'published'
    ),
    (
      'TEST-WA-LEAD-002', 'test-wa-lead-002', ${category.id}, 'منتج اختبار طلب واتساب 2',
      'قطعة', 1, 1, 15.00, 25.00, 0, 'out_of_stock'
    )
    on conflict (sku) do nothing
  `;

  const rows = await sql<{ id: number; sku: string }[]>`
    select id, sku from public.products where sku in ('TEST-WA-LEAD-001', 'TEST-WA-LEAD-002')
  `;
  fixtureProductId = rows.find((r) => r.sku === "TEST-WA-LEAD-001")!.id;
  secondFixtureProductId = rows.find((r) => r.sku === "TEST-WA-LEAD-002")!.id;
});

afterAll(async () => {
  await sql`delete from public.whatsapp_leads where idempotency_key = any(${createdIdempotencyKeys})`;
  await sql`delete from public.products where sku in ('TEST-WA-LEAD-001', 'TEST-WA-LEAD-002')`;
});

describe("createWhatsappLead — إنشاء سجل السلة", () => {
  test("ينشئ سجلاً بحالة whatsapp_pending وأسعار من القاعدة لا من المُدخَل", async () => {
    const idempotencyKey = nextIdempotencyKey();
    const result = await createWhatsappLead({
      idempotencyKey,
      items: [{ productId: fixtureProductId, variantId: null, quantity: 3 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toMatch(/^W-[0-9A-F]{8}$/);
    expect(result.isNew).toBe(true);

    const [row] = await sql<
      { status: string; items_subtotal: string; items: { unitPrice: number; quantity: number }[] }[]
    >`select status, items_subtotal, items from public.whatsapp_leads where idempotency_key = ${idempotencyKey}`;

    expect(row.status).toBe("whatsapp_pending");
    // 18.00 × 3 = 54.00 — من products.sale_price الحقيقي، وليس رقماً قد
    // يُرسله متصفّح زائر بسعر مزوَّر.
    expect(Number(row.items_subtotal)).toBe(54);
    expect(row.items).toHaveLength(1);
    expect(row.items[0].unitPrice).toBe(18);
    expect(row.items[0].quantity).toBe(3);
  });

  test("المرجع نفسه يُشتقّ حتماً من idempotencyKey في كل مرة", async () => {
    const idempotencyKey = nextIdempotencyKey();
    const first = await createWhatsappLead({
      idempotencyKey,
      items: [{ productId: fixtureProductId, variantId: null, quantity: 1 }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // نفس المرجع الذي بُني به رابط واتساب على المتصفح مسبقاً — لا نولّده
    // من جديد هنا، فيبقى متطابقاً دائماً.
    const { orderReferenceFromKey } = await import("@/lib/orders/orderMessage");
    expect(first.reference).toBe(orderReferenceFromKey(idempotencyKey));
  });

  test("ضغطتان بنفس idempotencyKey (ضغط مزدوج) لا تُنشئان سوى سجلّ واحد", async () => {
    const idempotencyKey = nextIdempotencyKey();
    const input = {
      idempotencyKey,
      items: [{ productId: fixtureProductId, variantId: null, quantity: 2 }],
    };

    const first = await createWhatsappLead(input);
    const second = await createWhatsappLead(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.reference).toBe(first.reference);

    const rows = await sql`select id from public.whatsapp_leads where idempotency_key = ${idempotencyKey}`;
    expect(rows).toHaveLength(1);
  });

  test("الرجوع للسلة وإعادة الضغط (نفس المفتاح المحفوظ محلياً) لا يُنشئ صفّاً ثانياً", async () => {
    // هذا الاختبار يُحاكي ما يحدث بعد أن يُعيد lib/orders/whatsappLeadKey.ts
    // نفس المفتاح المحفوظ محلياً لنفس محتوى السلة — أي أن الطلب الثاني هنا
    // ليس أبداً "ضغطة جديدة" فعلياً، بل نفس النية بمفتاح محفوظ من قبل.
    const idempotencyKey = nextIdempotencyKey();
    const cart = [{ productId: fixtureProductId, variantId: null, quantity: 4 }];

    const visitOne = await createWhatsappLead({ idempotencyKey, items: cart });
    // ... الزبون يغادر الصفحة (لصفحة منتج مثلاً) ثم يعود بنفس السلة تماماً،
    // فيقرأ نفس idempotencyKey من localStorage ويرسله من جديد ...
    const visitTwoAfterBack = await createWhatsappLead({ idempotencyKey, items: cart });

    expect(visitOne.ok && visitTwoAfterBack.ok).toBe(true);
    if (!visitOne.ok || !visitTwoAfterBack.ok) return;
    expect(visitTwoAfterBack.isNew).toBe(false);
    expect(visitTwoAfterBack.reference).toBe(visitOne.reference);

    const rows = await sql`select id from public.whatsapp_leads where idempotency_key = ${idempotencyKey}`;
    expect(rows).toHaveLength(1);
  });

  test("يقبل منتجاً غير متوفر أيضاً — هذه لقطة إعلامية لا فرض توفّر", async () => {
    const idempotencyKey = nextIdempotencyKey();
    const result = await createWhatsappLead({
      idempotencyKey,
      items: [{ productId: secondFixtureProductId, variantId: null, quantity: 1 }],
    });
    expect(result.ok).toBe(true);
  });

  test("يرفض سلة فارغة بلا اتصال بالقاعدة", async () => {
    const result = await createWhatsappLead({ idempotencyKey: nextIdempotencyKey(), items: [] });
    expect(result.ok).toBe(false);
  });

  test("يرفض idempotencyKey فارغاً", async () => {
    const result = await createWhatsappLead({
      idempotencyKey: "",
      items: [{ productId: fixtureProductId, variantId: null, quantity: 1 }],
    });
    expect(result.ok).toBe(false);
  });

  test("لا يُطلق Purchase/Meta CAPI إطلاقاً عند إنشاء lead — ولا حتى عند تكراره", async () => {
    const idempotencyKey = nextIdempotencyKey();
    const input = {
      idempotencyKey,
      items: [{ productId: fixtureProductId, variantId: null, quantity: 1 }],
    };

    await createWhatsappLead(input);
    await createWhatsappLead(input); // إعادة نفس المفتاح (ضغط مزدوج) أيضاً

    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });
});
