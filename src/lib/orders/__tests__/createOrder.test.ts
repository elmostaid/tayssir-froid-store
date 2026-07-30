import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { createOrder } from "@/lib/orders/createOrder";
import type { CreateOrderInput } from "@/lib/orders/types";

// هذه اختبارات تكامل حقيقية تحتاج قاعدة بيانات حية (محلية أو حاوية CI)
// عليها مخطط ومنتج DEMO-003 التجريبي الباقي (بعد حذف DEMO-001/002
// وتصنيفاتهما القديمة). TEST-FIXTURE-001/002 منتجا اختبار مؤقتان (تُنشأان
// وتُحذفان في هذا الملف فقط) بنفس مواصفات DEMO-001/002 السابقة لتغطية
// حالات الحد الأدنى ودرجة الزيادة ومخزون منتجين مختلفين.

const TEST_PHONE = "0600000099";

function baseCustomer() {
  return {
    fullName: "زبون اختبار",
    phone: TEST_PHONE,
    city: "مراكش",
    address: "حي المحاميد، شارع تجريبي",
    notes: null,
  };
}

async function getRawProduct(sku: string) {
  const rows = await sql<
    { id: number; sale_price: string; stock_quantity: number }[]
  >`select id, sale_price, stock_quantity from public.products where sku = ${sku}`;
  return rows[0];
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
      'TEST-FIXTURE-001', 'test-fixture-001', ${category.id}, 'منتج اختبار مؤقت 1',
      'قطعة', 5, 5, 8.00, 18.00, 120, 'published'
    ),
    (
      'TEST-FIXTURE-002', 'test-fixture-002', ${category.id}, 'منتج اختبار مؤقت 2',
      'قطعة', 10, 10, 15.00, 25.00, 50, 'published'
    )
    on conflict (sku) do nothing
  `;
});

afterAll(async () => {
  // تنظيف كل الطلبات التي أنشأتها هذه الاختبارات (order_items وسجل الحالة
  // يُحذَفان تلقائياً عبر on delete cascade)، ثم منتجا الاختبار المؤقتان.
  await sql`delete from public.orders where customer_phone = ${TEST_PHONE}`;
  await sql`delete from public.products where sku in ('TEST-FIXTURE-001', 'TEST-FIXTURE-002')`;
});

describe("createOrder — الحد الأدنى للطلبية", () => {
  test("يرفض طلباً مجموعه أقل من الحد الأدنى (1000 درهم)", async () => {
    const demo003 = await getRawProduct("DEMO-003"); // سعره 120 درهم
    const input: CreateOrderInput = {
      items: [{ productId: demo003.id, variantId: null, quantity: 1 }],
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("الحد الأدنى"))).toBe(true);
    }
  });

  test("يقبل طلباً بمنتجات مختلطة يصل مجموعها إلى 1000 درهم أو أكثر", async () => {
    const demo001 = await getRawProduct("TEST-FIXTURE-001"); // 18 درهم، حد أدنى 5
    const demo003 = await getRawProduct("DEMO-003"); // 120 درهم، حد أدنى 1

    const input: CreateOrderInput = {
      items: [
        { productId: demo001.id, variantId: null, quantity: 10 }, // 180
        { productId: demo003.id, variantId: null, quantity: 8 }, // 960 => المجموع 1140
      ],
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
  });
});

describe("createOrder — الكمية الدنيا ودرجة الزيادة", () => {
  test("يرفض كمية أقل من الحد الأدنى للمنتج", async () => {
    const demo001 = await getRawProduct("TEST-FIXTURE-001"); // حد أدنى 5

    const input: CreateOrderInput = {
      items: [{ productId: demo001.id, variantId: null, quantity: 3 }],
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("الحد الأدنى"))).toBe(true);
    }
  });

  test("يرفض كمية غير مطابقة لدرجة الزيادة", async () => {
    const demo002 = await getRawProduct("TEST-FIXTURE-002"); // حد أدنى 10، درجة زيادة 10

    const input: CreateOrderInput = {
      items: [{ productId: demo002.id, variantId: null, quantity: 15 }],
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(false);
  });
});

describe("createOrder — عدم الثقة بالسعر القادم من المتصفح", () => {
  test("يحتسب السعر من قاعدة البيانات وقت الطلب وليس أي قيمة مفترضة سابقاً", async () => {
    const demo002 = await getRawProduct("TEST-FIXTURE-002");
    const originalPrice = demo002.sale_price;

    try {
      // نغيّر السعر في قاعدة البيانات لمحاكاة تغيّره بعد أن حمّل الزبون
      // الصفحة (سعر "قديم" مخزَّن في السلة محلياً لدى الزبون)
      await sql`update public.products set sale_price = 999 where id = ${demo002.id}`;

      const input: CreateOrderInput = {
        items: [{ productId: demo002.id, variantId: null, quantity: 10 }],
        customer: baseCustomer(),
        idempotencyKey: randomUUID(),
      };

      const result = await createOrder(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const items = await sql<{ unit_price_snapshot: string }[]>`
        select oi.unit_price_snapshot
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where o.public_reference = ${result.publicReference}
      `;

      expect(Number(items[0].unit_price_snapshot)).toBe(999);
    } finally {
      await sql`update public.products set sale_price = ${originalPrice} where id = ${demo002.id}`;
    }
  });
});

describe("createOrder — منتج غير متوفر", () => {
  test("يرفض طلب منتج نفدت كميته من المخزون", async () => {
    const demo001 = await getRawProduct("TEST-FIXTURE-001");
    const originalStock = demo001.stock_quantity;

    try {
      await sql`update public.products set stock_quantity = 0 where id = ${demo001.id}`;

      const input: CreateOrderInput = {
        items: [{ productId: demo001.id, variantId: null, quantity: 5 }],
        customer: baseCustomer(),
        idempotencyKey: randomUUID(),
      };

      const result = await createOrder(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.message.includes("نفدت"))).toBe(true);
      }
    } finally {
      await sql`update public.products set stock_quantity = ${originalStock} where id = ${demo001.id}`;
    }
  });
});

describe("createOrder — منع الطلبات المكررة (idempotency)", () => {
  test("نفس مفتاح idempotency مرتين ينتج عنه نفس الطلب وليس طلبين", async () => {
    const demo003 = await getRawProduct("DEMO-003");
    const idempotencyKey = randomUUID();

    const input: CreateOrderInput = {
      items: [{ productId: demo003.id, variantId: null, quantity: 10 }], // 1200
      customer: baseCustomer(),
      idempotencyKey,
    };

    const first = await createOrder(input);
    const second = await createOrder(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.publicReference).toBe(first.publicReference);
    }

    const rows = await sql`select id from public.orders where idempotency_key = ${idempotencyKey}`;
    expect(rows.length).toBe(1);
  });
});

describe("createOrder — حالة غير متوفر للطلب", () => {
  test("يرفض طلب منتج حالته out_of_stock حتى لو كان المخزون أكبر من صفر", async () => {
    const demo001 = await getRawProduct("TEST-FIXTURE-001");

    try {
      await sql`update public.products set status = 'out_of_stock' where id = ${demo001.id}`;

      const input: CreateOrderInput = {
        items: [{ productId: demo001.id, variantId: null, quantity: 5 }],
        customer: baseCustomer(),
        idempotencyKey: randomUUID(),
      };

      const result = await createOrder(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.message.includes("غير متوفر"))).toBe(true);
      }
    } finally {
      await sql`update public.products set status = 'published' where id = ${demo001.id}`;
    }
  });
});

describe("createOrder — حدود طول بيانات الزبون", () => {
  test("يرفض اسماً كاملاً أطول من 100 حرف", async () => {
    const demo003 = await getRawProduct("DEMO-003");

    const input: CreateOrderInput = {
      items: [{ productId: demo003.id, variantId: null, quantity: 10 }],
      customer: { ...baseCustomer(), fullName: "أ".repeat(101) },
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "fullName")).toBe(true);
    }
  });

  test("يرفض عنواناً أطول من 300 حرف", async () => {
    const demo003 = await getRawProduct("DEMO-003");

    const input: CreateOrderInput = {
      items: [{ productId: demo003.id, variantId: null, quantity: 10 }],
      customer: { ...baseCustomer(), address: "ب".repeat(301) },
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "address")).toBe(true);
    }
  });

  test("يرفض ملاحظات أطول من 500 حرف", async () => {
    const demo003 = await getRawProduct("DEMO-003");

    const input: CreateOrderInput = {
      items: [{ productId: demo003.id, variantId: null, quantity: 10 }],
      customer: { ...baseCustomer(), notes: "ج".repeat(501) },
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "notes")).toBe(true);
    }
  });
});

describe("createOrder — تأجيل احتساب التوصيل", () => {
  test("الطلب الجديد لا يحتوي على عدد كرطونات أو مصاريف توصيل أو مجموع نهائي", async () => {
    const demo003 = await getRawProduct("DEMO-003");

    const input: CreateOrderInput = {
      items: [{ productId: demo003.id, variantId: null, quantity: 10 }],
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await sql<
      { carton_count: number | null; delivery_fee: string | null; final_total: string | null; status: string }[]
    >`select carton_count, delivery_fee, final_total, status from public.orders where public_reference = ${result.publicReference}`;

    expect(rows[0].carton_count).toBeNull();
    expect(rows[0].delivery_fee).toBeNull();
    expect(rows[0].final_total).toBeNull();
    expect(rows[0].status).toBe("new");
  });
});
