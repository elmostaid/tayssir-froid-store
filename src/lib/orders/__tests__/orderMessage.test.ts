import { describe, expect, test } from "vitest";
import {
  MAX_WHATSAPP_URL_BYTES,
  buildConfirmedOrderMessage,
  buildRescueOrderMessage,
  orderReferenceFromKey,
} from "@/lib/orders/orderMessage";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import type { CartItem } from "@/lib/cart/types";

const NUMBER = "+212722083458";
const CUSTOMER = {
  fullName: "محمد العلوي",
  phone: "0655123456",
  city: "مراكش",
  address: "حي المحاميد زنقة 12 رقم 45",
  notes: "",
};

// أسماء طويلة عمداً: الحرف العربي يصير 9 بايت بعد الترميز، وهذا ما فجّر
// الرابط في السلات الكبيرة على Production.
const item = (i: number): CartItem => ({
  productId: i,
  variantId: null,
  slug: `p-${i}`,
  sku: `TF-AC-${String(i).padStart(3, "0")}`,
  name: "غاز تبريد R410 للمكيفات المنزلية سبليت",
  variantName: null,
  unitPrice: 350,
  minOrderQty: 1,
  qtyIncrement: 1,
  imageUrl: null,
  quantity: 2,
});
const cart = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
const total = (items: CartItem[]) => items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

const rescue = (items: CartItem[]) =>
  buildRescueOrderMessage({
    storeName: "Tayssir Froid",
    customer: CUSTOMER,
    reference: orderReferenceFromKey("3f9a2c81-dead-beef-0000-111122223333"),
    items,
    subtotal: total(items),
    whatsappNumber: NUMBER,
  });

describe("مرجع الطلب", () => {
  test("يُشتقّ من idempotencyKey، فهو موجود قبل أي حفظ", () => {
    expect(orderReferenceFromKey("3f9a2c81-dead-beef-0000-111122223333")).toBe("W-3F9A2C81");
  });

  test("لا ينهار على مفتاح غريب", () => {
    expect(orderReferenceFromKey("")).toBe("W-00000000");
  });
});

describe("سقف طول رابط واتساب", () => {
  // العطل نفسه: 80 سطراً كانت تُنتج 17KB، والكتالوغ كله 43KB.
  test.each([1, 5, 20, 60, 150, 400])("سلة %i سطر تبقى تحت السقف", (n) => {
    const link = buildWhatsAppLink(NUMBER, rescue(cart(n)));
    expect(link.length).toBeLessThanOrEqual(MAX_WHATSAPP_URL_BYTES);
  });

  test("الرسالة المؤكَّدة قصيرة مهما كبرت السلة", () => {
    const items = cart(400);
    const link = buildWhatsAppLink(
      NUMBER,
      buildConfirmedOrderMessage({
        storeName: "Tayssir Froid",
        customer: CUSTOMER,
        reference: "W-3F9A2C81",
        orderNumber: "TF-2026-0031",
        items,
        subtotal: total(items),
      })
    );
    expect(link.length).toBeLessThanOrEqual(MAX_WHATSAPP_URL_BYTES);
  });
});

describe("الرسالة المؤكَّدة — الطلب محفوظ", () => {
  const items = cart(3);
  const message = buildConfirmedOrderMessage({
    storeName: "Tayssir Froid",
    customer: CUSTOMER,
    reference: "W-3F9A2C81",
    orderNumber: "TF-2026-0031",
    items,
    subtotal: total(items),
  });

  test("تحمل رقم الطلب والمرجع وبيانات الزبون والمجموع", () => {
    expect(message).toContain("TF-2026-0031");
    expect(message).toContain("W-3F9A2C81");
    expect(message).toContain("محمد العلوي");
    expect(message).toContain("حي المحاميد زنقة 12 رقم 45");
    expect(message).toContain("2.100,00 درهم");
    expect(message).toContain("3 منتجاً (6 قطعة)");
    expect(message).toContain("لوحة الإدارة");
  });

  test("لا تسرد المنتجات — التفاصيل في اللوحة", () => {
    expect(message).not.toContain("TF-AC-001");
  });
});

describe("رسالة الإنقاذ — لم يتأكّد الحفظ", () => {
  test("تحمل الطلبية نفسها مضغوطة (SKU × الكمية) بلا الأسماء الطويلة", () => {
    const message = rescue(cart(3));
    expect(message).toContain("TF-AC-001×2");
    expect(message).toContain("TF-AC-003×2");
    expect(message).not.toContain("غاز تبريد R410 للمكيفات المنزلية سبليت");
    expect(message).toContain("2.100,00 درهم");
  });

  test("بيانات الزبون تصل دائماً — هي أهم ما يجب ألّا يضيع", () => {
    const message = rescue(cart(500));
    expect(message).toContain("محمد العلوي");
    expect(message).toContain("0655123456");
    expect(message).toContain("حي المحاميد زنقة 12 رقم 45");
  });

  // القصّ الصامت أسوأ من القصّ: الفريق يجب أن يعرف أنه لم ير الطلبية كاملة.
  test("عند القصّ تُذكر المنتجات غير المذكورة صراحةً", () => {
    const message = rescue(cart(200));
    expect(message).toMatch(/… و\d+ منتجاً آخر/);
    expect(message).toContain("200 منتجاً");
  });

  test("سلة صغيرة لا تُقصّ إطلاقاً", () => {
    const message = rescue(cart(5));
    expect(message).not.toMatch(/منتجاً آخر/);
    for (let i = 1; i <= 5; i++) {
      expect(message).toContain(`TF-AC-${String(i).padStart(3, "0")}×2`);
    }
  });

  test("تقول صراحةً إنها نسخة إنقاذ غير مؤكَّدة الحفظ", () => {
    expect(rescue(cart(2))).toContain("لم يُؤكَّد حفظها");
  });
});
