import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";
import { POST } from "@/app/api/analytics/route";

// اختبار تكامل على قاعدة بيانات حقيقية عمداً: نصف ما نريد إثباته هنا يقع في
// القاعدة نفسها لا في الكود (قيد CHECK على event_name، وon delete set null
// في order_id). محاكاة sql كانت ستُخفي بالضبط هذه الضمانات.

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";

const TEST_PHONE_PREFIX = "068888";
let phoneCounter = 0;
let fixtureProductId: number;
const usedSessionIds: string[] = [];

function sessionId(): string {
  const id = randomUUID();
  usedSessionIds.push(id);
  return id;
}

function makeRequest(body: unknown, userAgent = MOBILE_UA) {
  return new NextRequest("http://localhost:3000/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": userAgent },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function batch(id: string, events: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    sessionId: id,
    context: {
      landingPath: "/",
      referrerHost: "l.facebook.com",
      utmSource: "facebook",
      utmMedium: "paid",
      utmCampaign: "MOROCCO_PURCHASE_BROAD",
      utmContent: "ad-01",
      utmTerm: null,
      hasClickId: true,
      startedAt: Date.now(),
    },
    deviceType: "mobile",
    browser: "fb_inapp",
    viewportW: 393,
    viewportH: 851,
    events,
    ...overrides,
  };
}

async function rowsFor(id: string) {
  return sql<
    {
      event_name: string;
      page_path: string | null;
      utm_campaign: string | null;
      has_click_id: boolean;
      device_type: string | null;
      browser: string | null;
      product_id: number | null;
      sku: string | null;
      quantity: number | null;
      cart_value: string | null;
      order_id: number | null;
      order_value: string | null;
      session_ms: number | null;
    }[]
  >`select * from public.analytics_events where session_id = ${id} order by id`;
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-ANALYTICS', 'test-fixture-analytics', ${category.id},
      'منتج اختبار القياس', 'قطعة', 1, 1, 100.00, 300.00, 500, 'published'
    )
    on conflict (sku) do update set stock_quantity = 500
    returning id
  `;
  fixtureProductId = product.id;
});

afterEach(async () => {
  if (usedSessionIds.length === 0) return;
  await sql`delete from public.analytics_events where session_id = any(${usedSessionIds})`;
  usedSessionIds.length = 0;
});

afterAll(async () => {
  await sql`delete from public.stock_movements where product_id = ${fixtureProductId}`;
  await sql`delete from public.orders where customer_phone like ${TEST_PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-ANALYTICS'`;
});

describe("POST /api/analytics — الأحداث السبعة", () => {
  test("دفعة كاملة بالأحداث السبعة تُدرَج كلها بنفس session_id", async () => {
    const id = sessionId();
    const response = await POST(
      makeRequest(
        batch(id, [
          { name: "session_start", pagePath: "/", sessionMs: 0 },
          { name: "landing_page_view", pagePath: "/", sessionMs: 12 },
          { name: "product_view", pagePath: "/product/x", sessionMs: 4000, productId: fixtureProductId, sku: "TEST-FIXTURE-ANALYTICS" },
          { name: "add_to_cart", pagePath: "/product/x", sessionMs: 9000, productId: fixtureProductId, sku: "TEST-FIXTURE-ANALYTICS", quantity: 50, cartValue: 15000 },
          { name: "cart_view", pagePath: "/cart", sessionMs: 12000, cartValue: 15000 },
          { name: "begin_checkout", pagePath: "/checkout", sessionMs: 20000, cartValue: 15000 },
          { name: "purchase", pagePath: "/checkout", sessionMs: 45000, orderValue: 15000, quantity: 50 },
        ])
      )
    );

    expect(response.status).toBe(204);
    const rows = await rowsFor(id);
    expect(rows.map((r) => r.event_name)).toEqual([
      "session_start",
      "landing_page_view",
      "product_view",
      "add_to_cart",
      "cart_view",
      "begin_checkout",
      "purchase",
    ]);
  });

  test("سياق الحملة والجهاز يُنسخان على كل حدث في الدفعة", async () => {
    const id = sessionId();
    await POST(
      makeRequest(
        batch(id, [
          { name: "session_start", pagePath: "/", sessionMs: 0 },
          { name: "cart_view", pagePath: "/cart", sessionMs: 3000 },
        ])
      )
    );

    const rows = await rowsFor(id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.utm_campaign).toBe("MOROCCO_PURCHASE_BROAD");
      expect(row.has_click_id).toBe(true);
      expect(row.device_type).toBe("mobile");
      expect(row.browser).toBe("fb_inapp");
    }
    expect(rows[1].page_path).toBe("/cart");
    expect(rows[1].session_ms).toBe(3000);
  });

  test("تفاصيل الإضافة للسلة تُحفظ كما هي (كمية وقيمة ومنتج)", async () => {
    const id = sessionId();
    await POST(
      makeRequest(
        batch(id, [
          {
            name: "add_to_cart",
            pagePath: "/",
            sessionMs: 5000,
            productId: fixtureProductId,
            sku: "TEST-FIXTURE-ANALYTICS",
            quantity: 24,
            cartValue: 7200.5,
          },
        ])
      )
    );

    const [row] = await rowsFor(id);
    expect(row.product_id).toBe(fixtureProductId);
    expect(row.sku).toBe("TEST-FIXTURE-ANALYTICS");
    expect(row.quantity).toBe(24);
    expect(Number(row.cart_value)).toBe(7200.5);
  });
});

describe("POST /api/analytics — ربط الشراء بالطلب الحقيقي", () => {
  test("مرجع الطلب يُترجَم إلى order_id، والمرجع نفسه لا يُخزَّن في أي عمود", async () => {
    phoneCounter += 1;
    const created = await createOrder({
      items: [{ productId: fixtureProductId, variantId: null, quantity: 4 }],
      customer: {
        fullName: "زبون اختبار القياس",
        phone: `${TEST_PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`,
        city: "الدار البيضاء",
        address: "عنوان اختبار",
        notes: null,
      },
      idempotencyKey: randomUUID(),
      requestContext: undefined,
    });
    expect(created.ok).toBe(true);
    const publicReference = created.ok ? created.publicReference : "";

    const [order] = await sql<{ id: number }[]>`
      select id from public.orders where public_reference = ${publicReference}
    `;

    const id = sessionId();
    await POST(
      makeRequest(
        batch(id, [
          { name: "purchase", pagePath: "/checkout", sessionMs: 60000, orderRef: publicReference, orderValue: 1200 },
        ])
      )
    );

    const [row] = await rowsFor(id);
    expect(row.order_id).toBe(order.id);
    expect(Number(row.order_value)).toBe(1200);

    const stored = await sql<{ found: number }[]>`
      select count(*)::int as found from public.analytics_events
      where session_id = ${id} and (sku = ${publicReference} or page_path = ${publicReference})
    `;
    expect(stored[0].found).toBe(0);
  });

  test("مرجع غير موجود: الحدث يُسجَّل بـorder_id فارغ بدل أن تسقط الدفعة", async () => {
    const id = sessionId();
    await POST(
      makeRequest(
        batch(id, [{ name: "purchase", pagePath: "/checkout", sessionMs: 1000, orderRef: randomUUID(), orderValue: 500 }])
      )
    );
    const [row] = await rowsFor(id);
    expect(row.event_name).toBe("purchase");
    expect(row.order_id).toBeNull();
  });

  test("حذف الطلب لاحقاً لا يحذف سجلّ القياس ولا يمنع الحذف — order_id يصير null", async () => {
    phoneCounter += 1;
    const created = await createOrder({
      items: [{ productId: fixtureProductId, variantId: null, quantity: 4 }],
      customer: {
        fullName: "زبون اختبار الحذف",
        phone: `${TEST_PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`,
        city: "أكادير",
        address: "عنوان اختبار",
        notes: null,
      },
      idempotencyKey: randomUUID(),
      requestContext: undefined,
    });
    expect(created.ok).toBe(true);
    const publicReference = created.ok ? created.publicReference : "";
    const [order] = await sql<{ id: number }[]>`
      select id from public.orders where public_reference = ${publicReference}
    `;

    const id = sessionId();
    await POST(
      makeRequest(batch(id, [{ name: "purchase", pagePath: "/checkout", sessionMs: 1000, orderRef: publicReference }]))
    );
    expect((await rowsFor(id))[0].order_id).toBe(order.id);

    await sql`delete from public.orders where id = ${order.id}`;

    const after = await rowsFor(id);
    expect(after).toHaveLength(1);
    expect(after[0].order_id).toBeNull();
  });
});

describe("POST /api/analytics — الرفض والحماية", () => {
  test("زحّاف/معاينة رابط: لا يُسجَّل أي شيء (وإلا فسدت كل نسبة تحويل)", async () => {
    const id = sessionId();
    const response = await POST(
      makeRequest(
        batch(id, [{ name: "session_start", pagePath: "/", sessionMs: 0 }]),
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
      )
    );
    expect(response.status).toBe(204);
    expect(await rowsFor(id)).toHaveLength(0);
  });

  test("session_id ليس UUID: يُرفَض بلا كتابة", async () => {
    const response = await POST(makeRequest(batch("not-a-uuid", [{ name: "cart_view", pagePath: "/cart", sessionMs: 0 }])));
    expect(response.status).toBe(204);
    const rows = await sql<{ found: number }[]>`
      select count(*)::int as found from public.analytics_events where page_path = '/cart' and browser = 'fb_inapp' and session_ms = 0
    `;
    expect(rows[0].found).toBe(0);
  });

  test("اسم حدث مخترَع يُتجاهَل، والأحداث الصحيحة في نفس الدفعة تمرّ", async () => {
    const id = sessionId();
    await POST(
      makeRequest(
        batch(id, [
          { name: "drop_table", pagePath: "/", sessionMs: 0 },
          { name: "session_start", pagePath: "/", sessionMs: 1 },
        ])
      )
    );
    const rows = await rowsFor(id);
    expect(rows.map((r) => r.event_name)).toEqual(["session_start"]);
  });

  test("دفعة ضخمة تُقصّ عند الحد الأعلى بدل إدراج آلاف الصفوف", async () => {
    const id = sessionId();
    const many = Array.from({ length: 500 }, (_, i) => ({
      name: "cart_view",
      pagePath: "/cart",
      sessionMs: i,
    }));
    await POST(makeRequest(batch(id, many)));
    expect(await rowsFor(id)).toHaveLength(20);
  });

  test("جسم غير صالح (JSON مكسور) لا يرمي ولا يُرجع خطأ للزائر", async () => {
    const response = await POST(makeRequest("{not json"));
    expect(response.status).toBe(204);
  });

  test("دفعة فارغة: لا شيء يُكتب", async () => {
    const id = sessionId();
    const response = await POST(makeRequest(batch(id, [])));
    expect(response.status).toBe(204);
    expect(await rowsFor(id)).toHaveLength(0);
  });

  test("قيم عددية سخيفة تُنظَّف بدل أن تصل القاعدة", async () => {
    const id = sessionId();
    await POST(
      makeRequest(
        batch(id, [
          {
            name: "add_to_cart",
            pagePath: "/",
            sessionMs: -50,
            quantity: 9e15,
            cartValue: -100,
            productId: fixtureProductId,
          },
        ])
      )
    );
    const [row] = await rowsFor(id);
    expect(row.quantity).toBeNull();
    expect(row.cart_value).toBeNull();
    expect(row.session_ms).toBeNull();
  });
});

describe("قاعدة البيانات نفسها ترفض ما قد يمرّ من الكود", () => {
  test("قيد CHECK يمنع أي اسم حدث خارج القائمة السبعة", async () => {
    await expect(
      sql`insert into public.analytics_events (session_id, event_name) values (${randomUUID()}, 'made_up')`
    ).rejects.toThrow();
  });
});
