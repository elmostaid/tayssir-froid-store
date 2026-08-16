import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

// اختبار End-to-End حقيقي لسلسلة الطلب الكاملة، مرحلة واحدة متصلة (وليس
// دوال منفصلة كما فباقي ملفات الاختبار): الزبون (submitOrder، نفس الحد
// الفاصل الذي يستدعيه CheckoutClient.tsx فعلياً) → قاعدة البيانات (طلب
// واحد، order_items صحيحة، purchase_price_snapshot، خصم مخزون مرة واحدة،
// stock_movements) → لوحة الإدارة (Staff يغيّر الحالة عبر كل مراحل
// workflow) → بون التحضير (بيانات وكميات صحيحة) → بعد التسليم (الربح
// والتقارير) → إلغاء طلب منفصل (استرجاع مرة واحدة فقط، منع مضاعف).
//
// getAdminUser() تحتاج جلسة Supabase Auth حقيقية غير متاحة فبيئة الاختبار
// — نُحاكيها هنا (Staff، لأن المطلوب صراحة أن يقدر Staff يغيّر الحالة عبر
// كل المراحل)، دون المساس بمنطق الحماية الحقيقي نفسه (مُختبَر منفصلاً فـ
// roleGuards.test.ts وroleGuardedActions.test.ts).
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  // تمرير مباشر: لا تخزين مؤقّت في الاختبارات، فينفَّذ الاستعلام الحقيقي.
  unstable_cache: (fn: unknown) => fn,
}));

const { submitOrder } = await import("@/app/(storefront)/checkout/actions");
const { updateOrderStatus, cancelOrderAction } = await import(
  "@/app/admin/(protected)/orders/actions"
);
const { getAdminOrderById, getAdminOrderItems, getAdminOrderStatusHistory, listAdminOrders, getDashboardOrderStats } =
  await import("@/lib/queries/adminOrders");
const { getDeliveredOrdersProfitBreakdown } = await import("@/lib/queries/adminReports");
const { buildPickingSlipBodyHtml } = await import("@/lib/pdf/pickingSlipHtml");
const { buildCustomerWhatsAppLink } = await import("@/lib/whatsapp");
const { toInternationalDigits } = await import("@/lib/phone");

const STAFF_USER = { id: "e2e-staff", email: "staff@local", role: "staff" as const };

const PURCHASE_PRICE = 150.0;
const SALE_PRICE = 400.0;
const PHONE_PREFIX = "0699";
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `${PHONE_PREFIX}${String(phoneCounter).padStart(6, "0")}`;
}

let productId: number;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-E2E-ORDER', 'test-fixture-e2e-order', ${category.id},
      'منتج اختبار دورة الطلب الكاملة', 'قطعة', 1, 1, ${PURCHASE_PRICE}, ${SALE_PRICE}, 50, 'published'
    )
    on conflict (sku) do update set
      purchase_price = ${PURCHASE_PRICE}, sale_price = ${SALE_PRICE}, stock_quantity = 50, status = 'published'
    returning id
  `;
  productId = product.id;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone like ${PHONE_PREFIX + "%"}`;
  await sql`delete from public.stock_movements where product_id = ${productId}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-E2E-ORDER'`;
});

function checkoutFormData(fields: {
  quantity: number;
  phone: string;
  idempotencyKey: string;
  fullName?: string;
}): FormData {
  const fd = new FormData();
  fd.set(
    "cartItems",
    JSON.stringify([{ productId, variantId: null, quantity: fields.quantity }])
  );
  fd.set("fullName", fields.fullName ?? "زبون اختبار E2E");
  fd.set("phone", fields.phone);
  fd.set("city", "الدار البيضاء");
  fd.set("address", "عنوان اختبار E2E الكامل");
  fd.set("notes", "");
  fd.set("idempotencyKey", fields.idempotencyKey);
  return fd;
}

async function getStock(): Promise<number> {
  const [row] = await sql<{ stock_quantity: number }[]>`
    select stock_quantity from public.products where id = ${productId}
  `;
  return row.stock_quantity;
}

describe("دورة الطلب الكاملة — من submitOrder (الزبون) إلى Delivered Revenue (بعد التسليم)", () => {
  test("السيناريو الكامل خطوة بخطوة", async () => {
    const dashboardBefore = await getDashboardOrderStats();
    const stockBefore = await getStock();
    const phone = nextPhone();
    const idempotencyKey = randomUUID();
    const quantity = 3; // 3 × 400 = 1200 (فوق الحد الأدنى 1000)

    // === 1) الزبون: منتج → سلة → Checkout → إنشاء الطلب (نفس submitOrder
    //     الذي يستدعيه CheckoutClient.tsx فعلياً، بنفس شكل FormData) ===
    const createResult = await submitOrder(
      { ok: null },
      checkoutFormData({ quantity, phone, idempotencyKey })
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const publicReference = createResult.publicReference;

    // === 2) قاعدة البيانات: طلب واحد فقط بهذا المرجع ===
    const orderRows = await sql<{ id: number; status: string }[]>`
      select id, status from public.orders where public_reference = ${publicReference}
    `;
    expect(orderRows).toHaveLength(1);
    const orderId = orderRows[0].id;
    expect(orderRows[0].status).toBe("new");

    // === order items صحيحة + purchase_price_snapshot محفوظ ===
    const itemRows = await sql<
      { quantity: number; unit_price_snapshot: string; purchase_price_snapshot: string | null; line_total: string }[]
    >`
      select quantity, unit_price_snapshot, purchase_price_snapshot, line_total
      from public.order_items where order_id = ${orderId}
    `;
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0].quantity).toBe(quantity);
    expect(Number(itemRows[0].unit_price_snapshot)).toBe(SALE_PRICE);
    expect(Number(itemRows[0].purchase_price_snapshot)).toBe(PURCHASE_PRICE);
    expect(Number(itemRows[0].line_total)).toBe(quantity * SALE_PRICE);

    // === خصم المخزون مرة واحدة فقط ===
    expect(await getStock()).toBe(stockBefore - quantity);

    // === stock_movements صحيح ===
    const movementsAfterCreate = await sql<{ reason: string; quantity_delta: number }[]>`
      select reason, quantity_delta from public.stock_movements where order_id = ${orderId}
    `;
    expect(movementsAfterCreate).toEqual([{ reason: "order_created", quantity_delta: -quantity }]);

    // === idempotency: نفس المفتاح مرة ثانية لا يُنشئ طلباً ثانياً ولا
    //     يخصم مخزوناً إضافياً ===
    const duplicateResult = await submitOrder(
      { ok: null },
      checkoutFormData({ quantity, phone, idempotencyKey })
    );
    expect(duplicateResult.ok).toBe(true);
    if (duplicateResult.ok) {
      expect(duplicateResult.publicReference).toBe(publicReference);
    }
    const ordersWithSameKey = await sql`select id from public.orders where idempotency_key = ${idempotencyKey}`;
    expect(ordersWithSameKey).toHaveLength(1);
    expect(await getStock()).toBe(stockBefore - quantity);

    // === 3) Admin/Staff: الطلب يظهر مباشرة فـ/admin/orders ===
    const adminList = await listAdminOrders({ query: phone });
    expect(adminList.some((o) => o.id === orderId)).toBe(true);

    // === Staff يستطيع فتحه (getAdminOrderById/getAdminOrderItems تنجحان) ===
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const orderDetail = await getAdminOrderById(orderId);
    expect(orderDetail).not.toBeNull();
    const orderItemsForDisplay = await getAdminOrderItems(orderId);
    expect(orderItemsForDisplay).toHaveLength(1);

    // === تغيير الحالة: جديد → تم التأكيد → قيد التجهيز → تم الإرسال →
    //     تم التسليم — عبر updateOrderStatus كما يستدعيه Staff فعلياً ===
    const statusSequence = ["confirmed", "preparing", "shipped", "delivered"] as const;
    for (const status of statusSequence) {
      getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
      const fd = new FormData();
      fd.set("orderId", String(orderId));
      fd.set("status", status);
      fd.set("note", "");
      const result = await updateOrderStatus({ error: null }, fd);
      expect(result.error).toBeNull();
    }

    const [finalOrder] = await sql<{ status: string }[]>`select status from public.orders where id = ${orderId}`;
    expect(finalOrder.status).toBe("delivered");

    const history = await getAdminOrderStatusHistory(orderId);
    expect(history.map((h) => h.status)).toEqual([
      "new",
      "confirmed",
      "preparing",
      "shipped",
      "delivered",
    ]);

    // الانتقال العادي بين الحالات لا يمس المخزون إطلاقاً
    expect(await getStock()).toBe(stockBefore - quantity);

    // === بون التحضير يعمل ويحتوي بيانات الطلب والكميات الصحيحة ===
    const pickingSlipHtml = buildPickingSlipBodyHtml(orderDetail!, orderItemsForDisplay);
    expect(pickingSlipHtml).toContain("منتج اختبار دورة الطلب الكاملة");
    expect(pickingSlipHtml).toContain("TEST-FIXTURE-E2E-ORDER");
    expect(pickingSlipHtml).toContain(`<td class="picking-emphasis">${quantity}</td>`);
    expect(pickingSlipHtml).toContain(orderDetail!.customerPhone);

    // === أزرار الاتصال وواتساب تعمل (روابط صحيحة برقم الزبون) ===
    const whatsappLink = buildCustomerWhatsAppLink(
      orderDetail!.customerPhone,
      orderDetail!.orderNumber,
      "بخصوص طلبكم {orderNumber}",
      "Tayssir Froid"
    );
    expect(whatsappLink).toContain(toInternationalDigits(phone));
    const callLink = `tel:+${toInternationalDigits(orderDetail!.customerPhone)}`;
    expect(callLink).toBe(`tel:+${toInternationalDigits(phone)}`);

    // === 4) بعد التسليم: Delivered Revenue وCOGS وGross Profit صحيحة ===
    const profitBreakdown = await getDeliveredOrdersProfitBreakdown(500);
    const profitRow = profitBreakdown.find((r) => r.orderId === orderId);
    expect(profitRow).toBeDefined();
    expect(Number(profitRow?.revenueMad)).toBeCloseTo(quantity * SALE_PRICE, 2);
    expect(Number(profitRow?.cogsMad)).toBeCloseTo(quantity * PURCHASE_PRICE, 2);
    expect(Number(profitRow?.profitMad)).toBeCloseTo(quantity * (SALE_PRICE - PURCHASE_PRICE), 2);
    expect(profitRow?.isExactHistoricalProfit).toBe(true);

    // === Dashboard يتحدَّث بشكل صحيح (فرق حقيقي، وليس قيمة مطلقة هشة) ===
    const dashboardAfter = await getDashboardOrderStats();
    expect(dashboardAfter.ordersToday).toBe(dashboardBefore.ordersToday + 1);
    expect(dashboardAfter.countsByStatus.delivered).toBe(dashboardBefore.countsByStatus.delivered + 1);
    expect(Number(dashboardAfter.salesTodayMad) - Number(dashboardBefore.salesTodayMad)).toBeCloseTo(
      quantity * SALE_PRICE,
      2
    );
  });
});

describe("الإلغاء بعد طلب حقيقي كامل — استرجاع مرة واحدة فقط، منع مضاعف", () => {
  test("طلب جديد عبر submitOrder ثم إلغاؤه يُرجع المخزون بالضبط مرة واحدة", async () => {
    const stockBefore = await getStock();
    const phone = nextPhone();
    const quantity = 3; // 3 × 400 = 1200 (فوق الحد الأدنى 1000)

    const createResult = await submitOrder(
      { ok: null },
      checkoutFormData({ quantity, phone, idempotencyKey: randomUUID() })
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const [order] = await sql<{ id: number }[]>`
      select id from public.orders where public_reference = ${createResult.publicReference}
    `;
    expect(await getStock()).toBe(stockBefore - quantity);

    getAdminUserMock.mockResolvedValueOnce(STAFF_USER); // Staff يقدر يلغي (ضمن workflow الطلبات)
    const firstCancel = await cancelOrderAction(
      { error: null },
      (() => {
        const fd = new FormData();
        fd.set("orderId", String(order.id));
        fd.set("note", "");
        return fd;
      })()
    );
    expect(firstCancel.error).toBeNull();
    expect(await getStock()).toBe(stockBefore); // رجع بالضبط

    const movements = await sql<{ reason: string; quantity_delta: number }[]>`
      select reason, quantity_delta from public.stock_movements
      where order_id = ${order.id} order by created_at asc
    `;
    expect(movements).toEqual([
      { reason: "order_created", quantity_delta: -quantity },
      { reason: "order_cancelled", quantity_delta: quantity },
    ]);

    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const secondCancel = await cancelOrderAction(
      { error: null },
      (() => {
        const fd = new FormData();
        fd.set("orderId", String(order.id));
        fd.set("note", "");
        return fd;
      })()
    );
    expect(secondCancel.error).not.toBeNull(); // ممنوع: لا استرجاع مضاعف
    expect(await getStock()).toBe(stockBefore); // بلا تغيير إضافي

    const movementsAfterSecondAttempt = await sql`
      select id from public.stock_movements where order_id = ${order.id}
    `;
    expect(movementsAfterSecondAttempt).toHaveLength(2); // لم تُضَف أي حركة ثالثة
  });
});
