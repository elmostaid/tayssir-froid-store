import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

/**
 * الترحيل لا يُرسل بيعةً بأثر رجعي — ولا GA4 كذلك.
 *
 * ## الخطر الذي يُختبَر هنا
 *
 * نقل الشراء إلى لحظة التأكيد يعني أن كل طلب قديم في حالة بيعة صار
 * "مستحقاً" لحدث شراء لم يُرسَل بعد. فبلا حرسٍ يُكتب في الترحيل نفسه، أول
 * لمسة حالة على أي طلب من مائة طلب تاريخي تُرسل إلى Meta بيعةً عمرها
 * أسابيع — وبعضها أُرسل أصلاً من المسار القديم، فتُحتسب مرتين.
 *
 * والحرس الثاني (GA4) أخطر: GA4 لا تُلغي التكرار حسب `transaction_id`، فكل
 * إرسال ثانٍ إيرادٌ مضاعف في التقارير.
 *
 * ## الحالتان المنسوختان من الإنتاج
 *
 * - **177**: طلب يدوي أُنشئ مؤكَّداً وأُرسلت بيعته فعلاً. يجب ألّا يُرسل
 *   شيئاً مرة أخرى، لا إلى Meta ولا إلى GA4.
 * - **176**: طلب موقع في `needs_review` لم تُرسَل بيعته قطّ. يجب أن يبقى
 *   **حرّاً** ليُرسل بيعته عند التأكيد — وهو بالضبط ما نُقل الحدث من أجله.
 */

const sendCapiEventMock = vi.hoisted(() =>
  vi.fn(async (payload: unknown) => {
    void payload;
    return { ok: true, eventsReceived: 1, status: 200 };
  })
);
vi.mock("@/lib/pixel/capi", () => ({
  sendCapiEvent: sendCapiEventMock,
  isCapiConfigured: () => true,
  hashForCapi: (value: string) => `sha256(${value})`,
}));

const { sendDeferredPurchase } = await import("@/lib/pixel/sendDeferredPurchase");

const PHONE_PREFIX = "066666";
let productId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-MIGRATION-GUARD', 'test-migration-guard', ${category.id},
      'منتج اختبار حرس الترحيل', 'قطعة', 1, 1, 50.00, 120.00, 400, 'published'
    )
    on conflict (sku) do update set stock_quantity = 400
    returning id
  `;
  productId = product.id;
});

afterAll(async () => {
  await sql`delete from public.stock_movements where product_id = ${productId}`;
  await sql`delete from public.orders where customer_phone like ${PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku = 'TEST-MIGRATION-GUARD'`;
});

beforeEach(() => {
  sendCapiEventMock.mockClear();
});

let phoneCounter = 0;

/** طلب خام بحالةٍ وحرسٍ محدَّدين — محاكاةٌ لصفٍّ كما تركه الترحيل. */
async function seedOrder(options: {
  source: string;
  status: string;
  metaGuard: boolean;
  gaGuard: boolean;
  reserved: boolean;
}): Promise<number> {
  phoneCounter += 1;
  const [order] = await sql<{ id: number }[]>`
    insert into public.orders (
      customer_name, customer_phone, customer_city, items_subtotal,
      status, source, confirmed_at,
      meta_purchase_sent_at, ga_purchase_sent_at
    ) values (
      'زبون حرس الترحيل', ${`${PHONE_PREFIX}${String(phoneCounter).padStart(4, "0")}`},
      'الدار البيضاء', 240, ${options.status}, ${options.source}, now(),
      ${options.metaGuard ? sql`now()` : null},
      ${options.gaGuard ? sql`now()` : null}
    )
    returning id
  `;
  await sql`
    insert into public.order_items (
      order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
      unit_price_snapshot, quantity, line_total, line_status
    ) values (
      ${order.id}, ${productId}, null, 'منتج اختبار حرس الترحيل',
      'TEST-MIGRATION-GUARD', 120, 2, 240,
      ${options.reserved ? "reserved" : "out_of_stock"}
    )
  `;
  return order.id;
}

describe("الترحيل: لا بيعة بأثر رجعي", () => {
  test("نسخة الطلب 177 (يدوي، أُرسلت بيعته): لا شيء يُرسَل من جديد", async () => {
    const orderId = await seedOrder({
      source: "whatsapp",
      status: "confirmed",
      metaGuard: true,
      gaGuard: true,
      reserved: true,
    });

    // يُرفَض مرتين: المصدر يدوي، والحرس مستهلك. فحتى لو رُفع أحدهما يبقى
    // الآخر — وهو ما يجعل الطلب 177 مستحيلاً إرساله ثانيةً.
    expect(await sendDeferredPurchase(orderId)).toEqual({ sent: false, reason: "not_website" });
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("طلب موقع تاريخي محروس: لا إرسال رجعي ولو تغيّرت حالته", async () => {
    const orderId = await seedOrder({
      source: "website",
      status: "delivered",
      metaGuard: true,
      gaGuard: true,
      reserved: true,
    });

    expect(await sendDeferredPurchase(orderId)).toEqual({ sent: false, reason: "already_sent" });
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("نسخة الطلب 176 (موقع، needs_review، بلا حرس): حرّ — ولا بيعة قبل التأكيد", async () => {
    const orderId = await seedOrder({
      source: "website",
      status: "needs_review",
      metaGuard: false,
      gaGuard: false,
      reserved: false,
    });

    // لم تُرسَل بيعته قطّ، فالحرس فارغ بحقّ — لكن الحالة ليست بيعة بعد.
    expect(await sendDeferredPurchase(orderId)).toEqual({ sent: false, reason: "not_a_sale" });
    expect(sendCapiEventMock).not.toHaveBeenCalled();

    // وحتى لو أُكّد وسطره ما زال غير محجوز: لا بيعة بلا سطر محجوز واحد.
    await sql`update public.orders set status = 'confirmed' where id = ${orderId}`;
    expect(await sendDeferredPurchase(orderId)).toMatchObject({
      sent: false,
      reason: "nothing_to_send",
    });
    expect(sendCapiEventMock).not.toHaveBeenCalled();

    // وبعد تسوية المخزون وتأكيده فعلاً: تُرسَل بيعته — مرة واحدة.
    await sql`update public.order_items set line_status = 'reserved' where order_id = ${orderId}`;
    const outcome = await sendDeferredPurchase(orderId);
    expect(outcome.sent).toBe(true);
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
    expect(await sendDeferredPurchase(orderId)).toEqual({ sent: false, reason: "already_sent" });
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
  });
});

describe("بيعة بلا سطر محجوز: تُرى، لا تُنسى", () => {
  test("طلب موقع شُحن وسطوره out_of_stock: السبب يُكتب على الطلب", async () => {
    // الطلب 176 في الإنتاج: 350 درهم، أُكّد وشُحن فعلاً، وسطره الوحيد
    // `out_of_stock`. خرجت الدالة صامتةً فلم تعرف Meta بالبيعة ولا بقي
    // أثرٌ يقول إن شيئاً فُقد — لا حدث ولا خطأ ولا سطر في أي تقرير.
    const orderId = await seedOrder({
      source: "website",
      status: "shipped",
      metaGuard: false,
      gaGuard: false,
      reserved: false,
    });

    const outcome = await sendDeferredPurchase(orderId);
    expect(outcome).toMatchObject({ sent: false, reason: "nothing_to_send" });
    expect(sendCapiEventMock).not.toHaveBeenCalled();

    const [row] = await sql<{ err: string | null; sent: Date | null }[]>`
      select meta_purchase_error as err, meta_purchase_sent_at as sent
      from public.orders where id = ${orderId}
    `;
    // السبب مكتوب، فيظهر في صفحة الطلب مع زرّ الإعادة بدل أن يُنسى.
    expect(row.err).toContain("لا سطر محجوز");
    // ولا يُستهلك الحرس: لا شيء أُرسل، فالبيعة ما زالت قابلة للإرسال.
    expect(row.sent).toBeNull();

    // وبعد تصحيح حالة السطر: تُرسَل، ويُمحى السبب.
    await sql`update public.order_items set line_status = 'reserved' where order_id = ${orderId}`;
    const retry = await sendDeferredPurchase(orderId);
    expect(retry.sent).toBe(true);
    const [after] = await sql<{ err: string | null; accepted: Date | null }[]>`
      select meta_purchase_error as err, meta_purchase_accepted_at as accepted
      from public.orders where id = ${orderId}
    `;
    expect(after.err).toBeNull();
    expect(after.accepted).not.toBeNull();
  });
});

describe("الترحيل: حرس GA4 يُكتب لكل طلب محروس لـMeta", () => {
  test("الاستعلام الذي يكتبه الترحيل لا يترك طلباً محروساً لـMeta بلا حرس GA4", async () => {
    const guarded = await seedOrder({
      source: "website",
      status: "delivered",
      metaGuard: true,
      gaGuard: false,
      reserved: true,
    });
    const free = await seedOrder({
      source: "website",
      status: "needs_review",
      metaGuard: false,
      gaGuard: false,
      reserved: false,
    });

    // نفس الاستعلام حرفياً كما في
    // supabase/migrations/20261008000000_conversion_delivery_guards.sql
    await sql`
      update public.orders
      set ga_purchase_sent_at = coalesce(confirmed_at, created_at)
      where ga_purchase_sent_at is null
        and meta_purchase_sent_at is not null
    `;

    const rows = await sql<{ id: number; ga: Date | null }[]>`
      select id, ga_purchase_sent_at as ga from public.orders
      where id in (${guarded}, ${free})
    `;
    const byId = new Map(rows.map((r) => [r.id, r.ga]));
    // المحروس لـMeta صار محروساً لـGA4.
    expect(byId.get(guarded)).not.toBeNull();
    // والحرّ يبقى حرّاً — وإلّا لفقد الطلب 176 بيعته في GA4 عند التأكيد.
    expect(byId.get(free)).toBeNull();
  });
});
