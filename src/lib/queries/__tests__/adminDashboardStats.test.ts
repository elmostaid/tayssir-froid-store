import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";
import { getDashboardOrderStats } from "@/lib/queries/adminOrders";

// getDashboardOrderStats() يجمّع على كل جدول orders (بيانات محيطة حقيقية
// موجودة أصلاً فالقاعدة، خارج سيطرة هذا الملف) — فنتحقق من "الفرق" (delta)
// الناتج عن طلب اختبار واحد معروف بالضبط، بدل افتراض قيم مطلقة هشة.
// 10 خانات بالضبط: 0 + [5-7] + 8 أرقام (نفس شرط isValidMoroccanPhone).
const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
const TEST_PHONE = `0644${randomSuffix}01`;
const TEST_PHONE_2 = `0644${randomSuffix}02`;

let fixtureProductId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-DASHBOARD', 'test-fixture-dashboard', ${category.id},
      'منتج اختبار Dashboard', 'قطعة', 1, 1, 200.00, 350.00, 200, 'published'
    )
    on conflict (sku) do update set stock_quantity = 200
    returning id
  `;
  fixtureProductId = product.id;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone in (${TEST_PHONE}, ${TEST_PHONE_2})`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-DASHBOARD'`;
});

describe("getDashboardOrderStats — الفرق الناتج عن طلب جديد معروف", () => {
  test("طلب جديد اليوم يزيد orders_today بواحد وsales_today بقيمة المنتجات بالضبط", async () => {
    const before = await getDashboardOrderStats();

    const result = await createOrder({
      items: [{ productId: fixtureProductId, variantId: null, quantity: 3 }], // 3 × 350 = 1050
      customer: {
        fullName: "زبون اختبار Dashboard",
        phone: TEST_PHONE,
        city: "مكناس",
        address: "عنوان اختبار",
        notes: null,
      },
      idempotencyKey: randomUUID(),
    });
    if (!result.ok) throw new Error("order failed: " + JSON.stringify(result.errors));

    const after = await getDashboardOrderStats();

    expect(after.ordersToday).toBe(before.ordersToday + 1);
    expect(Number(after.salesTodayMad) - Number(before.salesTodayMad)).toBeCloseTo(1050, 2);
    expect(Number(after.sales7DaysMad) - Number(before.sales7DaysMad)).toBeCloseTo(1050, 2);
    expect(Number(after.salesThisMonthMad) - Number(before.salesThisMonthMad)).toBeCloseTo(1050, 2);
    expect(after.countsByStatus.new).toBe(before.countsByStatus.new + 1);
  });

  test("طلب ملغى لا يُحتسَب فـsales_today رغم أن orders_today يبقى شاملاً له", async () => {
    const result = await createOrder({
      items: [{ productId: fixtureProductId, variantId: null, quantity: 3 }],
      customer: {
        fullName: "زبون اختبار إلغاء",
        phone: TEST_PHONE_2,
        city: "تطوان",
        address: "عنوان اختبار 2",
        notes: null,
      },
      idempotencyKey: randomUUID(),
    });
    if (!result.ok) throw new Error("order failed: " + JSON.stringify(result.errors));

    const before = await getDashboardOrderStats();

    // نغيّر الحالة مباشرة فقاعدة البيانات — هذا الاختبار يتحقق فقط من منطق
    // تجميع Dashboard (استبعاد الملغى من المبيعات)، وليس من منطق استرجاع
    // المخزون نفسه (ذاك مُختبَر بالكامل فـ actions.test.ts).
    await sql`
      update public.orders set status = 'cancelled'
      where public_reference = ${result.publicReference}
    `;

    const after = await getDashboardOrderStats();

    // orders_today لا يتغيّر (الطلب موجود أصلاً قبل الإلغاء، لم يُحذَف ولم
    // يُضَف طلب جديد) — لكن قيمته (1050) خرجت من sales_today بمجرد أن
    // status = 'cancelled' وقت الحساب (before هنا مأخوذة والطلب لا يزال
    // 'new'، أي لا تزال محتسَبة فيها).
    expect(after.ordersToday).toBe(before.ordersToday);
    expect(Number(before.salesTodayMad) - Number(after.salesTodayMad)).toBeCloseTo(1050, 2);
    expect(after.countsByStatus.cancelled).toBe(before.countsByStatus.cancelled + 1);

  });
});
