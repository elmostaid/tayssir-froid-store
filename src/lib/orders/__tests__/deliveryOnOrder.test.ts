import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: vi.fn() }));

const { createOrder } = await import("@/lib/orders/createOrder");

/**
 * ما يُكتب فعلاً في صفّ الطلب تحت سياسة التوصيل الحالية.
 *
 * الفحص على القاعدة لا على الواجهة، لأن الواجهة وحدها لا تكفي: يمكن أن
 * تختفي كلمة «مجاناً» من كل صفحة بينما يبقى الصفّ يحمل `delivery_fee = 0`،
 * فيُطبع الوعد الملغى في بون التحضير وفي الوصل وفي كل تقرير، ويقرأه من
 * يسلّم الطلب بيده.
 *
 * وملفٌ مستقلّ عمداً: `getSettings` مغلَّفة بـ`cache()`، فأول قراءة في
 * العملية تُثبَّت. لضبط الإعداد قبل أي قراءة نحتاج سجلّ وحدات نظيفاً،
 * وvitest يعزل كل ملف اختبار وحده.
 *
 * والأهمّ المُختبَر هنا: سياسة ما يدفعه الزبون **لا تلمس**
 * `actual_delivery_cost` — ما ندفعه نحن لشركة التوصيل مصروف حقيقي مستمرّ
 * للمحاسبة الداخلية، ويبقى NULL («غير مسجَّلة») يملؤه المدير كما كان.
 */
const SKU = "DELIVERY-POLICY-001";
let productId: number;
let previousFee: unknown;

beforeAll(async () => {
  const [{ value }] = await sql<{ value: unknown }[]>`
    select value from public.settings where key = 'delivery_fee_per_carton_mad'
  `;
  previousFee = value;

  // الإعداد يُثبَّت على قيمة موجبة عمداً: النتيجة يجب ألّا تتغيّر به
  // إطلاقاً بعد اليوم. لو عاد أحدهم يشتقّ delivery_fee من هذا الرقم،
  // سقط هذا الاختبار — وهو الحارس المقصود.
  await sql`
    update public.settings set value = to_jsonb(45::numeric)
    where key = 'delivery_fee_per_carton_mad'
  `;

  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      ${SKU}, 'delivery-policy-001', ${category.id}, 'منتج اختبار سياسة التوصيل',
      'قطعة', 1, 1, 90.00, 120.00, 50, 'published'
    )
    returning id
  `;
  productId = product.id;
});

afterAll(async () => {
  await sql`delete from public.products where sku = ${SKU}`;
  await sql`
    update public.settings set value = ${sql.json(previousFee as never)}
    where key = 'delivery_fee_per_carton_mad'
  `;
});

describe("طلب الموقع تحت سياسة «المصاريف تُحدَّد عند التأكيد»", () => {
  test("يُسجَّل delivery_fee = NULL وfinal_total = NULL، وactual_delivery_cost يبقى NULL", async () => {
    const result = await createOrder({
      items: [{ productId, variantId: null, quantity: 2 }],
      customer: {
        fullName: "زبون اختبار",
        phone: "0655990001",
        city: "مراكش",
        address: "عنوان اختبار",
        notes: null,
      },
      idempotencyKey: randomUUID(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await sql<
      {
        delivery_fee: string | null;
        final_total: string | null;
        items_subtotal: string;
        actual_delivery_cost: string | null;
      }[]
    >`
      select delivery_fee, final_total, items_subtotal, actual_delivery_cost
      from public.orders where public_reference = ${result.publicReference}
    `;

    // NULL لا صفر — والفرق بينهما هو كل الفائدة. صفرٌ يعني «الزبون لا
    // يدفع شيئاً للتوصيل»، وهو الوعد الذي أُلغي؛ وNULL يعني «لم يُحدَّد
    // بعد»، وهو ما تقوله السياسة. ولذلك يُفحص الحقل نفسه لا قيمته
    // الرقمية: Number(null) يساوي صفراً ويُخفي العطل تماماً.
    expect(row.delivery_fee).toBeNull();
    expect(row.final_total).toBeNull();

    // ومجموع المنتجات يبقى محسوباً كما هو — السياسة تمسّ التوصيل وحده.
    expect(Number(row.items_subtotal)).toBe(240);

    // نظام تكلفتنا الحقيقية لم يُمَسّ: «غير مسجَّلة» يملؤها المدير لاحقاً.
    expect(row.actual_delivery_cost).toBeNull();

    await sql`delete from public.orders where public_reference = ${result.publicReference}`;
  });
});
