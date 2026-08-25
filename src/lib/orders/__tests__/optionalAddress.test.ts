import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";

vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: vi.fn() }));
vi.mock("@/lib/notifications/notifyNewOrder", () => ({ notifyNewOrder: vi.fn() }));

const { createOrder } = await import("@/lib/orders/createOrder");
const { displayCustomerAddress, customerAddressOrNull } = await import(
  "@/lib/orders/customerAddress"
);
const { buildOrderWhatsAppMessage } = await import("@/lib/whatsapp");

const SKU = "ADDR-OPT-001";
// رقم لكل اختبار: isRateLimited حماية إنتاجية حقيقية (5 محاولات كل 5 دقائق)
// ولا يجوز إضعافها، فنتفاداها بأرقام مختلفة كما تفعل بقية اختبارات الطلبات.
const PHONE_PREFIX = "066001";
let phoneCounter = 0;
const nextPhone = () => `${PHONE_PREFIX}${String((phoneCounter += 1)).padStart(4, "0")}`;
let productId = 0;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`
    select id from public.categories order by id limit 1
  `;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      category_id, sku, slug, name_ar, unit_label, sale_price, purchase_price,
      stock_quantity, min_order_qty, qty_increment, status
    ) values (
      ${category.id}, ${SKU}, 'addr-opt-product', 'منتج اختبار العنوان', 'قطعة',
      100, 60, 500, 1, 1, 'published'
    )
    on conflict (sku) do update set stock_quantity = 500, status = 'published'
    returning id
  `;
  productId = product.id;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone like ${PHONE_PREFIX + "%"}`;
  await sql`delete from public.products where sku = ${SKU}`;
});

const customer = (address: string) => ({
  fullName: "زبون بلا عنوان",
  phone: nextPhone(),
  city: "مراكش",
  address,
  notes: null,
});

async function savedAddress(reference: string) {
  const [row] = await sql<{ customer_address: string | null }[]>`
    select customer_address from public.orders where public_reference = ${reference}
  `;
  return row.customer_address;
}

describe("العنوان اختياري في طلب الموقع", () => {
  test("طلب بلا عنوان يمرّ ويُحفظ NULL", async () => {
    const result = await createOrder({
      items: [{ productId, variantId: null, quantity: 1 }],
      customer: customer(""),
      idempotencyKey: `addr-empty-${Date.now()}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsReview).toBe(false);
    expect(await savedAddress(result.publicReference)).toBeNull();
  });

  test("عنوان من فراغات وحدها يُحفظ NULL أيضاً، لا نصاً فارغاً", async () => {
    const result = await createOrder({
      items: [{ productId, variantId: null, quantity: 1 }],
      customer: customer("   \n  "),
      idempotencyKey: `addr-blank-${Date.now()}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await savedAddress(result.publicReference)).toBeNull();
  });

  test("طلب بعنوان يظل يعمل كما كان", async () => {
    const result = await createOrder({
      items: [{ productId, variantId: null, quantity: 2 }],
      customer: customer("حي الرجاء، شارع الإدريسي، رقم 12"),
      idempotencyKey: `addr-present-${Date.now()}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await savedAddress(result.publicReference)).toBe("حي الرجاء، شارع الإدريسي، رقم 12");
  });

  test("الاسم والمدينة والهاتف تبقى إجبارية", async () => {
    const result = await createOrder({
      items: [{ productId, variantId: null, quantity: 1 }],
      customer: { ...customer(""), city: "" },
      idempotencyKey: `addr-city-${Date.now()}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "city")).toBe(true);
    // ولا يُشتكى من العنوان إطلاقاً بعد أن صار اختيارياً.
    expect(result.errors.some((e) => e.field === "address")).toBe(false);
  });

  test("العنوان الطويل يبقى مرفوضاً — القيد في القاعدة لم يتغيّر", async () => {
    const result = await createOrder({
      items: [{ productId, variantId: null, quantity: 1 }],
      customer: customer("ع".repeat(301)),
      idempotencyKey: `addr-long-${Date.now()}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "address")).toBe(true);
  });
});

describe("عرض العنوان الغائب", () => {
  test("«غير محدد» لكل صور الغياب", () => {
    expect(displayCustomerAddress(null)).toBe("غير محدد");
    expect(displayCustomerAddress("")).toBe("غير محدد");
    expect(displayCustomerAddress("   ")).toBe("غير محدد");
    expect(customerAddressOrNull("  ")).toBeNull();
  });

  test("العنوان الحقيقي يُعرض كما هو، مقصوصاً من الفراغات", () => {
    expect(displayCustomerAddress("  حي السلام  ")).toBe("حي السلام");
    expect(customerAddressOrNull("حي السلام")).toBe("حي السلام");
  });
});

describe("رسالة واتساب بلا عنوان", () => {
  const items = [
    {
      productId: 1,
      variantId: null,
      sku: "X-1",
      slug: "x-1",
      name: "قطعة",
      variantName: null,
      unitPrice: 100,
      quantity: 1,
      imageUrl: null,
      minOrderQty: 1,
      qtyIncrement: 1,
      stockQuantity: 5,
    },
  ];

  test("سطر العنوان يسقط كلياً حين لا عنوان", () => {
    const message = buildOrderWhatsAppMessage({
      storeName: "متجر الاختبار",
      customer: { fullName: "زبون", phone: "0655000000", city: "مراكش", address: "", notes: "" },
      items,
      subtotal: 100,
    });

    expect(message).not.toContain("العنوان:");
    expect(message).toContain("المدينة: مراكش");
    expect(message).toContain("الهاتف:");
  });

  test("سطر العنوان يظهر حين يوجد", () => {
    const message = buildOrderWhatsAppMessage({
      storeName: "متجر الاختبار",
      customer: { fullName: "زبون", phone: "0655000000", city: "مراكش", address: "حي السلام", notes: "" },
      items,
      subtotal: 100,
    });

    expect(message).toContain("العنوان: حي السلام");
  });
});
