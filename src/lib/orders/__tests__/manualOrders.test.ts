import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

// نتجسّس على Meta CAPI لنُثبت أن الطلب اليدوي **لا يُرسل Purchase** إطلاقاً.
const sendCapiEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));

const { createManualOrder } = await import("@/lib/orders/createManualOrder");
const { updateOrderLines } = await import("@/lib/orders/updateOrderLines");

const PHONE = "0655000001";
const SKUS = ["MAN-FIX-001", "MAN-FIX-002", "MAN-FIX-003"];

async function product(sku: string) {
  const [row] = await sql<
    { id: number; sale_price: string; purchase_price: string | null; stock_quantity: number }[]
  >`select id, sale_price, purchase_price, stock_quantity from public.products where sku = ${sku}`;
  return row;
}
const stockOf = async (sku: string) => (await product(sku)).stock_quantity;

async function orderRow(orderId: number) {
  const [row] = await sql<
    {
      status: string;
      source: string;
      items_subtotal: string;
      delivery_fee: string | null;
      final_total: string | null;
      order_number: string;
    }[]
  >`select status, source, items_subtotal, delivery_fee, final_total, order_number
    from public.orders where id = ${orderId}`;
  return row;
}

async function itemsOf(orderId: number) {
  return sql<
    {
      sku_snapshot: string;
      quantity: number;
      unit_price_snapshot: string;
      line_total: string;
      purchase_price_snapshot: string | null;
      line_status: string;
    }[]
  >`select sku_snapshot, quantity, unit_price_snapshot, line_total, purchase_price_snapshot,
      line_status
    from public.order_items where order_id = ${orderId} order by sku_snapshot`;
}

const movements = (orderId: number) =>
  sql<{ quantity_delta: number; reason: string }[]>`
    select quantity_delta, reason from public.stock_movements
    where order_id = ${orderId} order by id
  `;

function customer() {
  return {
    fullName: "زبون واتساب",
    phone: PHONE,
    city: "مراكش",
    address: "حي المحاميد",
    notes: null,
  };
}

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values
    ('MAN-FIX-001', 'man-fix-001', ${category.id}, 'قطعة يدوية 1', 'قطعة', 5, 5, 60.00, 100.00, 100, 'published'),
    ('MAN-FIX-002', 'man-fix-002', ${category.id}, 'قطعة يدوية 2', 'قطعة', 1, 1, 120.00, 200.00, 40, 'published'),
    ('MAN-FIX-003', 'man-fix-003', ${category.id}, 'قطعة يدوية 3', 'قطعة', 1, 1, null, 50.00, 10, 'out_of_stock')
    on conflict (sku) do nothing
  `;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone = ${PHONE}`;
  await sql`delete from public.products where sku = any(${SKUS})`;
});

describe("الطلب اليدوي — بيع وقع خارج الموقع", () => {
  test("يُنشئ طلباً عادياً بمصدر whatsapp وحالة confirmed ورقم كبقية الطلبات", async () => {
    const p1 = await product("MAN-FIX-001");
    const p2 = await product("MAN-FIX-002");

    const result = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 45,
      createdByEmail: "admin@test.local",
      items: [
        { productId: p1.id, variantId: null, quantity: 5 },
        { productId: p2.id, variantId: null, quantity: 2 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await orderRow(result.orderId);
    expect(order.source).toBe("whatsapp");
    expect(order.status).toBe("confirmed");
    expect(order.order_number).toMatch(/^TF-\d{4}-\d{4}$/);
    // 5×100 + 2×200 = 900، والتوصيل 45 → 945
    expect(Number(order.items_subtotal)).toBe(900);
    expect(Number(order.delivery_fee)).toBe(45);
    expect(Number(order.final_total)).toBe(945);
  });

  test("لا يُرسل Purchase إلى Meta إطلاقاً", async () => {
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("يقبل ما دون الحد الأدنى للطلب — البيع وقع فعلاً", async () => {
    const p2 = await product("MAN-FIX-002");
    const result = await createManualOrder({
      customer: customer(),
      source: "phone",
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
      items: [{ productId: p2.id, variantId: null, quantity: 1 }], // 200 درهم فقط
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(Number((await orderRow(result.orderId)).items_subtotal)).toBe(200);
  });

  test("يقبل كمية لا تحترم الكمية الدنيا للموقع — قاعدة تسويق لا قانون طبيعة", async () => {
    const p1 = await product("MAN-FIX-001"); // الحد الأدنى 5 بمضاعفات 5
    const result = await createManualOrder({
      customer: customer(),
      source: "store",
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
      items: [{ productId: p1.id, variantId: null, quantity: 3 }],
    });
    expect(result.ok).toBe(true);
  });

  test("ثمن بيع خاص يُحفظ كما اتُّفق عليه، والتكلفة تبقى الحقيقية", async () => {
    const p2 = await product("MAN-FIX-002"); // بيع 200، شراء 120
    const result = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
      items: [{ productId: p2.id, variantId: null, quantity: 2, unitPriceOverride: 170 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [item] = await itemsOf(result.orderId);
    expect(Number(item.unit_price_snapshot)).toBe(170);
    expect(Number(item.line_total)).toBe(340);
    expect(Number(item.purchase_price_snapshot)).toBe(120); // الربح 100، لا 160
    expect(Number((await orderRow(result.orderId)).items_subtotal)).toBe(340);
  });

  test("يخصم المخزون بالكمية المطلوبة ويسجّل حركة order_created", async () => {
    const before = await stockOf("MAN-FIX-002");
    const p2 = await product("MAN-FIX-002");

    const result = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
      items: [{ productId: p2.id, variantId: null, quantity: 4 }],
    });

    expect(result.ok).toBe(true);
    expect(await stockOf("MAN-FIX-002")).toBe(before - 4);
    if (result.ok) {
      expect(await movements(result.orderId)).toEqual([
        { quantity_delta: -4, reason: "order_created" },
      ]);
    }
  });

  test("يرفض كمية تتجاوز المخزون بدل أن يجعله سالباً", async () => {
    const p2 = await product("MAN-FIX-002");
    const before = await stockOf("MAN-FIX-002");

    const result = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
      items: [{ productId: p2.id, variantId: null, quantity: before + 1 }],
    });

    expect(result.ok).toBe(false);
    expect(await stockOf("MAN-FIX-002")).toBe(before);
  });

  test("يسجّل بيع منتج موسوم «غير متوفر» — الوسم يخصّ الموقع لا الواقع", async () => {
    const p3 = await product("MAN-FIX-003");
    const result = await createManualOrder({
      customer: customer(),
      source: "store",
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
      items: [{ productId: p3.id, variantId: null, quantity: 2 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // تكلفة غير معروفة تبقى null: لا نخترع رقماً (انظر تقارير الأرباح).
      const [item] = await itemsOf(result.orderId);
      expect(item.purchase_price_snapshot).toBeNull();
    }
  });

  test("يرفض المصدر website — هذا المسار للبيع خارج الموقع وحده", async () => {
    const p2 = await product("MAN-FIX-002");
    const result = await createManualOrder({
      customer: customer(),
      source: "website",
      deliveryFee: 0,
      createdByEmail: "admin@test.local",
      items: [{ productId: p2.id, variantId: null, quantity: 1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].field).toBe("source");
  });

  test("يرفض بيانات زبون ناقصة أو هاتفاً غير صالح", async () => {
    const p2 = await product("MAN-FIX-002");
    const items = [{ productId: p2.id, variantId: null, quantity: 1 }];
    const base = { source: "whatsapp" as const, deliveryFee: 0, createdByEmail: "a@b.c", items };

    const noName = await createManualOrder({ ...base, customer: { ...customer(), fullName: "  " } });
    expect(noName.ok).toBe(false);

    const badPhone = await createManualOrder({ ...base, customer: { ...customer(), phone: "12345" } });
    expect(badPhone.ok).toBe(false);
    if (!badPhone.ok) expect(badPhone.errors[0].field).toBe("phone");
  });
});

describe("تعديل طلب قائم — المخزون بالفرق وحده", () => {
  async function seedOrder(quantity: number) {
    const p1 = await product("MAN-FIX-001");
    const result = await createManualOrder({
      customer: customer(),
      source: "whatsapp",
      deliveryFee: 45,
      createdByEmail: "admin@test.local",
      items: [{ productId: p1.id, variantId: null, quantity }],
    });
    if (!result.ok) throw new Error("تعذّر تهيئة الطلب");
    return { orderId: result.orderId, productId: p1.id };
  }

  test("من 3 إلى 5 يحجز 2 فقط، ومن 5 إلى 2 يُرجع 3 — بلا خصم مزدوج", async () => {
    const { orderId, productId } = await seedOrder(3);
    const afterCreate = await stockOf("MAN-FIX-001");

    const up = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 5 }],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });
    expect(up.ok).toBe(true);
    expect(await stockOf("MAN-FIX-001")).toBe(afterCreate - 2);

    const down = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 2 }],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });
    expect(down.ok).toBe(true);
    expect(await stockOf("MAN-FIX-001")).toBe(afterCreate + 1); // 3 محجوزة صارت 2

    // الحركات: إنشاء −3، ثم −2، ثم +3 — الفرق لا الكمية الكاملة.
    expect(await movements(orderId)).toEqual([
      { quantity_delta: -3, reason: "order_created" },
      { quantity_delta: -2, reason: "manual_adjustment" },
      { quantity_delta: 3, reason: "manual_adjustment" },
    ]);
  });

  test("إضافة منتج تحجز مخزونه، وحذفه يُرجعه كاملاً", async () => {
    const { orderId, productId } = await seedOrder(5);
    const p2 = await product("MAN-FIX-002");
    const stock2Before = await stockOf("MAN-FIX-002");

    const added = await updateOrderLines({
      orderId,
      items: [
        { productId, variantId: null, quantity: 5 },
        { productId: p2.id, variantId: null, quantity: 3 },
      ],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.itemsSubtotal).toBe(5 * 100 + 3 * 200);
    expect(await stockOf("MAN-FIX-002")).toBe(stock2Before - 3);

    const removed = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 5 }],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.itemsSubtotal).toBe(500);
    expect(await stockOf("MAN-FIX-002")).toBe(stock2Before);
    expect(await itemsOf(orderId)).toHaveLength(1);
  });

  test("تغيير ثمن البيع يُحدّث المجموع ولا يلمس المخزون", async () => {
    const { orderId, productId } = await seedOrder(5);
    const stockBefore = await stockOf("MAN-FIX-001");

    const result = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 5, unitPriceOverride: 80 }],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.itemsSubtotal).toBe(400);
    expect(await stockOf("MAN-FIX-001")).toBe(stockBefore);
    expect(Number((await orderRow(orderId)).items_subtotal)).toBe(400);
  });

  test("تعديل التوصيل يُعيد حساب المجموع النهائي", async () => {
    const { orderId, productId } = await seedOrder(5);
    const result = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 5 }],
      deliveryFee: 90,
      changedByEmail: "admin@test.local",
    });

    expect(result.ok).toBe(true);
    const order = await orderRow(orderId);
    expect(Number(order.delivery_fee)).toBe(90);
    expect(Number(order.final_total)).toBe(500 + 90);
  });

  test("الطلب الملغى يُرفض تعديله — مخزونه أُرجع، فالتعديل يخصم مرتين", async () => {
    const { orderId, productId } = await seedOrder(5);
    await sql`update public.orders set status = 'cancelled' where id = ${orderId}`;
    const stockBefore = await stockOf("MAN-FIX-001");

    const result = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 9 }],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toContain("مرتين");
    expect(await stockOf("MAN-FIX-001")).toBe(stockBefore);
  });

  // كان هذا الاختبار يحرس رفضَ التعديل كلِّه عند نقص المخزون. تغيّر العقد
  // عمداً: مديرٌ يضيف عشرة منتجات لا يجوز أن يخسرها لأن واحداً نفد. السطر
  // الناقص يُحفظ بحالته والطلب يُرفع إلى «يحتاج مراجعة».
  test("زيادة تتجاوز المخزون تُحفظ out_of_stock وترفع الطلب إلى needs_review", async () => {
    const { orderId, productId } = await seedOrder(5);
    const available = await stockOf("MAN-FIX-001");

    const result = await updateOrderLines({
      orderId,
      items: [{ productId, variantId: null, quantity: 5 + available + 1 }],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsReview).toBe(true);
    expect(result.outOfStock).toHaveLength(1);

    // الحجز السابق (5) عاد إلى المخزون، ولا شيء بقي محجوزاً لسطرٍ لا يمسك شيئاً.
    expect(await stockOf("MAN-FIX-001")).toBe(available + 5);

    const [item] = await itemsOf(orderId);
    expect(item.quantity).toBe(5 + available + 1);
    expect(item.line_status).toBe("out_of_stock");

    const [order] = await sql<{ status: string }[]>`
      select status from public.orders where id = ${orderId}
    `;
    expect(order.status).toBe("needs_review");
  });

  test("تفريغ الطلب من كل منتجاته مرفوض", async () => {
    const { orderId } = await seedOrder(5);
    const result = await updateOrderLines({
      orderId,
      items: [],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].field).toBe("items");
  });

  test("سطران لنفس المنتج بنفس الثمن يُدمجان بدل حساب المخزون مرتين", async () => {
    const { orderId, productId } = await seedOrder(5);
    const stockBefore = await stockOf("MAN-FIX-001");

    const result = await updateOrderLines({
      orderId,
      items: [
        { productId, variantId: null, quantity: 4 },
        { productId, variantId: null, quantity: 3 },
      ],
      deliveryFee: null,
      changedByEmail: "admin@test.local",
    });

    expect(result.ok).toBe(true);
    expect(await itemsOf(orderId)).toHaveLength(1);
    expect((await itemsOf(orderId))[0].quantity).toBe(7);
    expect(await stockOf("MAN-FIX-001")).toBe(stockBefore - 2); // 5 صارت 7
  });
});
