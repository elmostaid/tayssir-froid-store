import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import type { CreateOrderInput } from "@/lib/orders/types";

// نتجسّس على sendCapiEvent (Meta Conversions API) دون التأثير على أي منطق
// حقيقي: بلا هذا الموك، الدالة الحقيقية لا تفعل شيئاً أصلاً فبيئة الاختبار
// (لا META_CONVERSIONS_API_ACCESS_TOKEN مضبوطاً) — نفس النتيجة تماماً لكل
// الاختبارات الأخرى فهذا الملف، وهنا فقط نتحقق من متى/كيف تُستدعى.
const sendCapiEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));

const { createOrder } = await import("@/lib/orders/createOrder");

// هذه اختبارات تكامل حقيقية تحتاج قاعدة بيانات حية (محلية أو حاوية CI).
// كل منتجات المرحلة الأولى التجريبية (DEMO-001/002/003) وتصنيفاتها
// القديمة حُذفت الآن. TEST-FIXTURE-001/002/003 منتجات اختبار مؤقتة
// (تُنشأ وتُحذف في هذا الملف فقط) بنفس مواصفات DEMO-001/002/003 السابقة.

// كل اختبار يستعمل رقم هاتف مختلف (بادئة ثابتة 060000 + عدّاد) بدل رقم واحد
// مشترك — لأن isRateLimited() (حماية حقيقية ضد تكرار الطلبات من نفس الرقم،
// 5 محاولات كحد أقصى كل 5 دقائق) حماية إنتاجية صحيحة يجب ألا تُضعَف من أجل
// الاختبارات، لكنها كانت تُحجب اختبارات لاحقة في هذا الملف عن طريق الخطأ
// لأنها كلها كانت تشارك نفس رقم الهاتف الواحد فتتراكم المحاولات وتتجاوز 5.
const TEST_PHONE_PREFIX = "060000";
let testPhoneCounter = 0;
function nextTestPhone(): string {
  testPhoneCounter += 1;
  return `${TEST_PHONE_PREFIX}${String(testPhoneCounter).padStart(4, "0")}`;
}

function baseCustomer() {
  return {
    fullName: "زبون اختبار",
    phone: nextTestPhone(),
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
    ),
    (
      'TEST-FIXTURE-003', 'test-fixture-003', ${category.id}, 'منتج اختبار مؤقت 3',
      'قطعة', 1, 1, 90.00, 120.00, 30, 'published'
    ),
    (
      -- مخزون كبير عمداً ومخصَّص فقط لاختبارات Meta CAPI (وصف منفصل أسفل
      -- الملف): تلك الاختبارات لا يجب أن تتنافس على نفس مخزون TEST-FIXTURE-003
      -- المحدود (30) مع بقية اختبارات هذا الملف.
      'TEST-FIXTURE-CAPI', 'test-fixture-capi', ${category.id}, 'منتج اختبار CAPI',
      'قطعة', 1, 1, 10.00, 20.00, 100000, 'published'
    )
    on conflict (sku) do nothing
  `;
});

afterAll(async () => {
  // تنظيف كل الطلبات التي أنشأتها هذه الاختبارات (order_items وسجل الحالة
  // يُحذَفان تلقائياً عبر on delete cascade)، ثم منتجات الاختبار المؤقتة.
  await sql`delete from public.orders where customer_phone like ${TEST_PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku in ('TEST-FIXTURE-001', 'TEST-FIXTURE-002', 'TEST-FIXTURE-003', 'TEST-FIXTURE-CAPI')`;
});

describe("createOrder — الحد الأدنى للطلبية", () => {
  test("يرفض طلباً مجموعه أقل من الحد الأدنى (1000 درهم)", async () => {
    const demo003 = await getRawProduct("TEST-FIXTURE-003"); // سعره 120 درهم
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
    const demo003 = await getRawProduct("TEST-FIXTURE-003"); // 120 درهم، حد أدنى 1

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
    const demo003 = await getRawProduct("TEST-FIXTURE-003");
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

describe("createOrder — طلب متعدد الأسطر (batching للإدخالات)", () => {
  test("طلب بعدة أسطر: كل order_items وstock_movements تُدرَج بالكامل وبقيم صحيحة", async () => {
    const demo001 = await getRawProduct("TEST-FIXTURE-001"); // 18 درهم
    const demo002 = await getRawProduct("TEST-FIXTURE-002"); // 25 درهم
    const demo003 = await getRawProduct("TEST-FIXTURE-003"); // 120 درهم

    const input: CreateOrderInput = {
      items: [
        { productId: demo001.id, variantId: null, quantity: 10 }, // 180
        { productId: demo002.id, variantId: null, quantity: 10 }, // 250
        { productId: demo003.id, variantId: null, quantity: 5 }, // 600 => المجموع 1030
      ],
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };

    try {
      const result = await createOrder(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const items = await sql<{ sku_snapshot: string; quantity: number }[]>`
        select oi.sku_snapshot, oi.quantity
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where o.public_reference = ${result.publicReference}
        order by oi.sku_snapshot
      `;
      expect(items).toEqual([
        { sku_snapshot: "TEST-FIXTURE-001", quantity: 10 },
        { sku_snapshot: "TEST-FIXTURE-002", quantity: 10 },
        { sku_snapshot: "TEST-FIXTURE-003", quantity: 5 },
      ]);

      const movements = await sql<{ product_id: number; quantity_delta: number; reason: string }[]>`
        select sm.product_id, sm.quantity_delta, sm.reason
        from public.stock_movements sm
        join public.orders o on o.id = sm.order_id
        where o.public_reference = ${result.publicReference}
        order by sm.product_id
      `;
      expect(movements).toEqual([
        { product_id: demo001.id, quantity_delta: -10, reason: "order_created" },
        { product_id: demo002.id, quantity_delta: -10, reason: "order_created" },
        { product_id: demo003.id, quantity_delta: -5, reason: "order_created" },
      ]);
    } finally {
      // منتجات الاختبار مشتركة مع اختبارات أخرى فهذا الملف تعتمد على مخزون
      // TEST-FIXTURE-003 المحدود (30) بأرقام مضبوطة مسبقاً — نُعيد كل مخزون
      // استهلكناه هنا لتفادي التأثير على تلك الاختبارات الأخرى.
      await sql`update public.products set stock_quantity = ${demo001.stock_quantity} where id = ${demo001.id}`;
      await sql`update public.products set stock_quantity = ${demo002.stock_quantity} where id = ${demo002.id}`;
      await sql`update public.products set stock_quantity = ${demo003.stock_quantity} where id = ${demo003.id}`;
    }
  });

  test("تعارض مخزون على سطر غير أول يُلغي المعاملة كاملة — لا كتابة جزئية ولا نقص مخزون على الأسطر السابقة", async () => {
    const demo001 = await getRawProduct("TEST-FIXTURE-001"); // مخزون كافٍ
    const demo002Before = await getRawProduct("TEST-FIXTURE-002");
    const idempotencyKey = randomUUID();

    try {
      // نُنقِص مخزون المنتج الثاني عمداً ليصبح أقل من الكمية المطلوبة —
      // السطر الأول (TEST-FIXTURE-001) يُحجَز بنجاح قبل أن يفشل السطر الثاني.
      await sql`update public.products set stock_quantity = 3 where id = ${demo002Before.id}`;

      const input: CreateOrderInput = {
        items: [
          { productId: demo001.id, variantId: null, quantity: 10 }, // 180، ينجح أولاً
          { productId: demo002Before.id, variantId: null, quantity: 10 }, // يطلب أكثر من المتوفر (3)
        ],
        customer: baseCustomer(),
        idempotencyKey,
      };

      const result = await createOrder(input);
      expect(result.ok).toBe(false);

      const orders = await sql`select id from public.orders where idempotency_key = ${idempotencyKey}`;
      expect(orders.length).toBe(0);

      const demo001After = await getRawProduct("TEST-FIXTURE-001");
      expect(demo001After.stock_quantity).toBe(demo001.stock_quantity);

      const demo002After = await getRawProduct("TEST-FIXTURE-002");
      expect(demo002After.stock_quantity).toBe(3);
    } finally {
      await sql`update public.products set stock_quantity = ${demo002Before.stock_quantity} where id = ${demo002Before.id}`;
    }
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

describe("createOrder — تعطيل استقبال الطلبات (cod_enabled)", () => {
  test("cod_enabled=false يرفض الطلب، ولا يُنشأ أي صف، ولا ينقص المخزون", async () => {
    const demo003 = await getRawProduct("TEST-FIXTURE-003"); // 120 درهم، حد أدنى 1
    const originalStock = demo003.stock_quantity;

    try {
      await sql`update public.settings set value = to_jsonb(false) where key = 'cod_enabled'`;

      const idempotencyKey = randomUUID();
      const input: CreateOrderInput = {
        items: [{ productId: demo003.id, variantId: null, quantity: 10 }], // 1200 (يتجاوز الحد الأدنى)
        customer: baseCustomer(),
        idempotencyKey,
      };

      const result = await createOrder(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.message.includes("متوقف"))).toBe(true);
      }

      const orders = await sql`select id from public.orders where idempotency_key = ${idempotencyKey}`;
      expect(orders.length).toBe(0);

      const afterStock = await getRawProduct("TEST-FIXTURE-003");
      expect(afterStock.stock_quantity).toBe(originalStock);
    } finally {
      await sql`update public.settings set value = to_jsonb(true) where key = 'cod_enabled'`;
    }
  });

  test("cod_enabled=true (إعادة التفعيل) يسمح بإنشاء الطلب عادياً", async () => {
    const demo003 = await getRawProduct("TEST-FIXTURE-003");
    const originalStock = demo003.stock_quantity;

    await sql`update public.settings set value = to_jsonb(false) where key = 'cod_enabled'`;
    await sql`update public.settings set value = to_jsonb(true) where key = 'cod_enabled'`;

    try {
      const input: CreateOrderInput = {
        items: [{ productId: demo003.id, variantId: null, quantity: 10 }], // 1200
        customer: baseCustomer(),
        idempotencyKey: randomUUID(),
      };

      const result = await createOrder(input);

      expect(result.ok).toBe(true);
    } finally {
      // نُعيد المخزون كما كان — هذا الاختبار يتحقق فقط أن إعادة التفعيل
      // تسمح بإنشاء الطلب، وليس المقصود منه استهلاك مخزون منتج الاختبار
      // المشترك مع اختبارات أخرى فهذا الملف.
      await sql`update public.products set stock_quantity = ${originalStock} where id = ${demo003.id}`;
    }
  });
});

describe("createOrder — حدود طول بيانات الزبون", () => {
  test("يرفض اسماً كاملاً أطول من 100 حرف", async () => {
    const demo003 = await getRawProduct("TEST-FIXTURE-003");

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
    const demo003 = await getRawProduct("TEST-FIXTURE-003");

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
    const demo003 = await getRawProduct("TEST-FIXTURE-003");

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
    const demo003 = await getRawProduct("TEST-FIXTURE-003");

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

describe("createOrder — Meta Conversions API (Purchase) مرتبط بـPixel بنفس event_id", () => {
  test("نجاح حقيقي: sendCapiEvent تُستدعى مرة واحدة، event_id = idempotencyKey نفسه، وبيانات المنتجات صحيحة", async () => {
    sendCapiEventMock.mockClear();
    const demoCapi = await getRawProduct("TEST-FIXTURE-CAPI");
    const idempotencyKey = randomUUID();
    const customer = baseCustomer();

    const input: CreateOrderInput = {
      items: [{ productId: demoCapi.id, variantId: null, quantity: 60 }], // 60*20=1200 >= 1000
      customer,
      idempotencyKey,
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(true);

    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
    const call = sendCapiEventMock.mock.calls[0][0];
    expect(call.eventName).toBe("Purchase");
    // نفس event_id بالضبط المُستعمَل من جهة المتصفح (Pixel) لنفس الطلب —
    // شرط deduplication الصحيح بين Pixel وCAPI.
    expect(call.eventId).toBe(idempotencyKey);
    expect(call.customData.content_ids).toEqual(["TEST-FIXTURE-CAPI"]);
    expect(call.customData.value).toBe(1200);
    expect(call.customData.num_items).toBe(60);
    expect(call.customData.currency).toBe("MAD");
    expect(call.customData.content_type).toBe("product");
  });

  test("طلب فاشل (تحت الحد الأدنى): sendCapiEvent لا تُستدعى إطلاقاً", async () => {
    sendCapiEventMock.mockClear();
    const demoCapi = await getRawProduct("TEST-FIXTURE-CAPI");

    const input: CreateOrderInput = {
      items: [{ productId: demoCapi.id, variantId: null, quantity: 1 }], // 20 فقط، أقل من الحد الأدنى
      customer: baseCustomer(),
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(false);
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("إعادة إرسال بنفس idempotencyKey (ضغط مزدوج): sendCapiEvent تُستدعى مرة واحدة فقط، ليس مرتين", async () => {
    sendCapiEventMock.mockClear();
    const demoCapi = await getRawProduct("TEST-FIXTURE-CAPI");
    const idempotencyKey = randomUUID();

    const input: CreateOrderInput = {
      items: [{ productId: demoCapi.id, variantId: null, quantity: 60 }],
      customer: baseCustomer(),
      idempotencyKey,
    };

    const first = await createOrder(input);
    const second = await createOrder(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
  });

  test("رقم الهاتف يُمرَّر بصيغة أرقام دولية خالصة (بلا +، بلا صفر بادئ) لـuser_data.phone", async () => {
    sendCapiEventMock.mockClear();
    const demoCapi = await getRawProduct("TEST-FIXTURE-CAPI");
    const phone = nextTestPhone(); // 06XXXXXXXX

    const input: CreateOrderInput = {
      items: [{ productId: demoCapi.id, variantId: null, quantity: 60 }],
      customer: { ...baseCustomer(), phone },
      idempotencyKey: randomUUID(),
    };

    const result = await createOrder(input);
    expect(result.ok).toBe(true);

    const call = sendCapiEventMock.mock.calls[0][0];
    expect(call.userData.phone).toBe(`212${phone.slice(1)}`);
  });
});
