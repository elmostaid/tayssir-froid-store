import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: vi.fn() }));

const { createOrder } = await import("@/lib/orders/createOrder");

/**
 * ما يُكتب فعلاً في صفّ الطلب حين يكون التوصيل مجانياً.
 *
 * الفحص على القاعدة لا على الواجهة: نصٌّ يقول «مجاناً» بينما الصفّ يحمل
 * NULL في delivery_fee يترك لوحة الإدارة تنتظر رقماً لن يأتي، ويُبقي مبلغ
 * الطلب مؤقّتاً بلا سبب.
 *
 * وملفٌ مستقلّ عمداً: `getSettings` مغلَّفة بـ`cache()`، فأول قراءة في
 * العملية تُثبَّت. لضبط الإعداد قبل أي قراءة نحتاج سجلّ وحدات نظيفاً،
 * وvitest يعزل كل ملف اختبار وحده.
 *
 * والأهمّ المُختبَر هنا: مجانية التوصيل على الزبون **لا تلمس**
 * `actual_delivery_cost` — ما ندفعه نحن لشركة التوصيل مصروف حقيقي مستمرّ،
 * وصفرٌ هناك كذبٌ محاسبي لا تخفيض.
 */
const SKU = "FREE-DEL-FIX-001";
let productId: number;
let previousFee: unknown;

beforeAll(async () => {
  const [{ value }] = await sql<{ value: unknown }[]>`
    select value from public.settings where key = 'delivery_fee_per_carton_mad'
  `;
  previousFee = value;

  // صفر = مجاني، قبل أي استدعاء لـcreateOrder في هذه العملية.
  await sql`
    update public.settings set value = to_jsonb(0::numeric)
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
      ${SKU}, 'free-del-fix-001', ${category.id}, 'منتج اختبار التوصيل المجاني',
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

describe("طلب الموقع مع توصيل مجاني", () => {
  test("يُسجَّل delivery_fee = 0 ومجموعاً نهائياً، وactual_delivery_cost يبقى NULL", async () => {
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

    // صفر صريح، لا NULL — والفرق بينهما هو كل الفائدة، لذلك نتحقّق من
    // عدم كونه NULL قبل تحويله رقماً (Number(null) يساوي 0 ويُخفي العطل).
    expect(row.delivery_fee).not.toBeNull();
    expect(Number(row.delivery_fee)).toBe(0);

    // المجموع النهائي = مجموع المنتجات وحده، بلا أي إضافة.
    expect(row.final_total).not.toBeNull();
    expect(Number(row.final_total)).toBe(Number(row.items_subtotal));
    expect(Number(row.items_subtotal)).toBe(240);

    // نظام تكلفتنا الحقيقية لم يُمَسّ: «غير مسجَّلة» يملؤها المدير لاحقاً.
    expect(row.actual_delivery_cost).toBeNull();

    await sql`delete from public.orders where public_reference = ${result.publicReference}`;
  });
});
