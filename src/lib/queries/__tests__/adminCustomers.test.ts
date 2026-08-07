import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";
import { listAdminCustomers } from "@/lib/queries/adminCustomers";

// اختبار تكامل حقيقي (نفس نمط createOrder.test.ts) — رقم هاتف مميَّز لهذا
// الملف حتى لا يختلط بأي طلبات اختبار أخرى تشارك القاعدة نفسها. الاسم أيضاً
// يتضمن رمزاً فريداً (نفس الرقم) حتى لا يتصادم بحث الاسم مع بيانات اختبار
// سابقة أخرى فنفس القاعدة (مثلاً اسم "محمد العلمي" استُعمل سابقاً فاختبارات
// يدوية أخرى فهذا الملف نفسه من الجلسة).
const TEST_PHONE = "062222" + Math.floor(Math.random() * 10000).toString().padStart(4, "0");
const OTHER_TEST_PHONE = "063333" + Math.floor(Math.random() * 10000).toString().padStart(4, "0");
const UNIQUE_NAME_TOKEN = TEST_PHONE.slice(-4);

let fixtureProductId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-CUSTOMERS', 'test-fixture-customers', ${category.id},
      'منتج اختبار الزبائن', 'قطعة', 1, 1, 200.00, 350.00, 200, 'published'
    )
    on conflict (sku) do update set stock_quantity = 200
    returning id
  `;
  fixtureProductId = product.id;

  // نفس الزبون (نفس الهاتف) بأسماء مكتوبة بشكل مختلف قليلاً بين طلبين —
  // يجب أن يبقى زبوناً واحداً فالنتيجة، بآخر اسم استعمله (الثاني).
  const order1 = await createOrder({
    items: [{ productId: fixtureProductId, variantId: null, quantity: 3 }],
    customer: {
      fullName: `محمد العلمي ${UNIQUE_NAME_TOKEN}`,
      phone: TEST_PHONE,
      city: "مراكش",
      address: "عنوان 1",
      notes: null,
    },
    idempotencyKey: randomUUID(),
  });
  if (!order1.ok) throw new Error("order1 failed: " + JSON.stringify(order1.errors));

  const order2 = await createOrder({
    items: [{ productId: fixtureProductId, variantId: null, quantity: 4 }],
    customer: {
      fullName: `محمد العلمي (الاسم الصحيح) ${UNIQUE_NAME_TOKEN}`,
      phone: TEST_PHONE,
      city: "الدار البيضاء",
      address: "عنوان 2",
      notes: null,
    },
    idempotencyKey: randomUUID(),
  });
  if (!order2.ok) throw new Error("order2 failed: " + JSON.stringify(order2.errors));

  // نضبط الطلب الثاني كـ"مُسلَّم" مباشرة فقاعدة البيانات (مسار الإدارة نفسه
  // يحتاج جلسة Supabase Auth حقيقية غير متاحة هنا؛ التأثير على الجدول نفسه
  // مطابق تماماً لما يفعله updateOrderStatus).
  await sql`
    update public.orders set status = 'delivered'
    where public_reference = ${order2.publicReference}
  `;

  // زبون مختلف تماماً — للتأكد أن الفلترة/التجميع لا يخلطه بالزبون الأول.
  const otherOrder = await createOrder({
    items: [{ productId: fixtureProductId, variantId: null, quantity: 3 }],
    customer: {
      fullName: "فاطمة بنعلي",
      phone: OTHER_TEST_PHONE,
      city: "فاس",
      address: "عنوان 3",
      notes: null,
    },
    idempotencyKey: randomUUID(),
  });
  if (!otherOrder.ok) throw new Error("otherOrder failed: " + JSON.stringify(otherOrder.errors));
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone in (${TEST_PHONE}, ${OTHER_TEST_PHONE})`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-CUSTOMERS'`;
});

describe("listAdminCustomers — تجميع الطلبات حسب رقم الهاتف بلا تكرار", () => {
  test("نفس الهاتف بأسماء مختلفة قليلاً = زبون واحد فقط، بآخر اسم/مدينة استُعملا", async () => {
    const customers = await listAdminCustomers({ query: TEST_PHONE });

    expect(customers).toHaveLength(1);
    expect(customers[0].phone).toBe(TEST_PHONE);
    expect(customers[0].name).toBe(`محمد العلمي (الاسم الصحيح) ${UNIQUE_NAME_TOKEN}`);
    expect(customers[0].city).toBe("الدار البيضاء");
  });

  test("عدد الطلبات وعدد/قيمة الطلبات المسلَّمة صحيحان (طلب واحد مسلَّم من أصل طلبين)", async () => {
    const customers = await listAdminCustomers({ query: TEST_PHONE });
    const customer = customers[0];

    expect(customer.ordersCount).toBe(2);
    expect(customer.deliveredOrdersCount).toBe(1);
    // 4 قطع × 350.00 = 1400.00 (الطلب الثاني فقط، المُسلَّم)
    expect(Number(customer.deliveredTotalMad)).toBe(1400);
  });

  test("البحث برقم هاتف زبون آخر لا يرجع زبوناً غير متعلق به", async () => {
    const customers = await listAdminCustomers({ query: OTHER_TEST_PHONE });

    expect(customers).toHaveLength(1);
    expect(customers[0].phone).toBe(OTHER_TEST_PHONE);
    expect(customers[0].ordersCount).toBe(1);
  });

  test("البحث بجزء من الاسم يرجع كل طلبات نفس الزبون كاملة (وليس فقط الطلب المطابق حرفياً)", async () => {
    // نبحث بنص موجود فقط فاسم الطلب الأول ("محمد العلمي {token}" بدون
    // الإضافة)، بينما اسم الزبون الحالي (الأحدث) مختلف قليلاً ("... الاسم
    // الصحيح ..."). النتيجة يجب أن تشمل كلا الطلبين رغم أن نص البحث غير
    // موجود حرفياً إلا فالطلب الأول.
    const customers = await listAdminCustomers({ query: `محمد العلمي ${UNIQUE_NAME_TOKEN}` });

    expect(customers).toHaveLength(1);
    expect(customers[0].phone).toBe(TEST_PHONE);
    expect(customers[0].ordersCount).toBe(2);
  });
});
