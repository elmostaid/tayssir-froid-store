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
    deliveryFeePerCartonMad: 30,
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
        whatsappNumber: NUMBER,
        deliveryFeePerCartonMad: 30,
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
    whatsappNumber: NUMBER,
    deliveryFeePerCartonMad: 30,
  });

  test("تحمل رقم الطلب والمرجع وبيانات الزبون والمجموع", () => {
    expect(message).toContain("TF-2026-0031");
    expect(message).toContain("W-3F9A2C81");
    expect(message).toContain("محمد العلوي");
    expect(message).toContain("حي المحاميد زنقة 12 رقم 45");
    expect(message).toContain("2.100,00 درهم");
    expect(message).toContain("3 منتجاً (6 قطعة)");
  });

  // البون يجب أن يبقى مفهوماً للموظّف حتى حين يكون الطلب محفوظاً.
  test("تسرد المنتجات بأسمائها وكمياتها", () => {
    expect(message).toMatch(/غاز تبريد R410 للمكيفات المنزلية سبليت.*× 2/);
  });

  test("طلب يحتاج مراجعة: تنبيه صريح ومجموع غير نهائي", () => {
    const items = cart(3);
    const msg = buildConfirmedOrderMessage({
      storeName: "Tayssir Froid", customer: CUSTOMER, reference: "W-3F9A2C81",
      orderNumber: "TF-2026-0031", items, subtotal: total(items),
      whatsappNumber: NUMBER, needsReview: true,
      deliveryFeePerCartonMad: 30,
    });
    expect(msg).toContain("يحتاج مراجعة مخزون");
    expect(msg).toContain("المجموع المطلوب قبل مراجعة المخزون");
    expect(msg).not.toMatch(/^المجموع [\d.]/m);
  });

  test("سلة ضخمة: الباقي يُحال إلى رقم الطلب لا إلى أكواد", () => {
    const items = cart(400);
    const msg = buildConfirmedOrderMessage({
      storeName: "Tayssir Froid", customer: CUSTOMER, reference: "W-3F9A2C81",
      orderNumber: "TF-2026-0031", items, subtotal: total(items), whatsappNumber: NUMBER,
      deliveryFeePerCartonMad: 30,
    });
    expect(msg).toMatch(/\+\d+ منتجات أخرى محفوظة كاملة في الطلب TF-2026-0031/);
    expect(buildWhatsAppLink(NUMBER, msg).length).toBeLessThanOrEqual(MAX_WHATSAPP_URL_BYTES);
  });
});

describe("رسالة الإنقاذ — لم يتأكّد الحفظ", () => {
  // العطل الذي تحرسه: الصيغة الأولى كانت `SKU×الكمية`. حمَت المتصفّح لكنها
  // أهدرت البون — الموظّف لا يحفظ الأكواد، فوصلته ورقة أرقام لا طلبية.
  test("كل منتج يظهر باسمه البشري وكميته", () => {
    const message = rescue(cart(3));
    expect(message).toContain("غاز تبريد R410 للمكيفات المنزلية سبليت");
    expect(message).toMatch(/غاز تبريد R410 للمكيفات المنزلية سبليت.*× 2/);
    expect(message).toContain("2.100,00 درهم");
  });

  test("SKU يُضاف بعد الاسم ما دام الحجم يسمح", () => {
    expect(rescue(cart(3))).toContain("(TF-AC-001)");
  });

  // لا تراجع إلى الأكواد مهما ضاق السقف: الاسم آخر ما يُتنازل عنه.
  test("لا سطر بكود بلا اسم مهما كبرت السلة", () => {
    for (const n of [40, 150, 400]) {
      const message = rescue(cart(n));
      const lines = message.split("\n").filter((l) => l.startsWith("- "));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/[؀-ۿ]/);
        expect(line).not.toMatch(/^- TF-AC-\d+ ?× ?\d+$/);
      }
    }
  });

  test("الاسم الطويل يُقصَّر عند حدّ كلمة ويبقى مُعرِّفاً", () => {
    const message = rescue(cart(150));
    const line = message.split("\n").find((l) => l.startsWith("- "))!;
    expect(line).toContain("غاز تبريد");
    expect(line.length).toBeLessThan(60);
  });

  test("بيانات الزبون تصل دائماً — هي أهم ما يجب ألّا يضيع", () => {
    const message = rescue(cart(500));
    expect(message).toContain("محمد العلوي");
    expect(message).toContain("0655123456");
    expect(message).toContain("حي المحاميد زنقة 12 رقم 45");
  });

  test("عدد المنتجات والقطع والمجموع حاضرة مهما قُصَّت السطور", () => {
    const message = rescue(cart(200));
    expect(message).toContain("200 منتجاً (400 قطعة)");
    expect(message).toContain("140.000,00 درهم");
  });

  // القصّ الصامت أسوأ من القصّ: الفريق يجب أن يعرف أنه لم ير الطلبية كاملة،
  // وألّا نَعِده بلوحة إدارة قد لا تحمل الطلب أصلاً (الحفظ غير مؤكَّد).
  test("عند القصّ تُذكر البقية مع المرجع وبديل الاتصال بالزبون", () => {
    const message = rescue(cart(200));
    expect(message).toMatch(/… و\d+ منتجاً آخر/);
    expect(message).toContain("W-3F9A2C81");
    expect(message).toContain("اتصلوا بالزبون");
  });

  test("سلة صغيرة لا تُقصّ إطلاقاً", () => {
    const message = rescue(cart(5));
    expect(message).not.toMatch(/منتجاً آخر/);
    expect(message.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(5);
  });

  test("تقول صراحةً إنها نسخة إنقاذ غير مؤكَّدة الحفظ", () => {
    expect(rescue(cart(2))).toContain("لم يُؤكَّد الحفظ");
  });
});
