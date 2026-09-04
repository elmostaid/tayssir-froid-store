import { describe, expect, test } from "vitest";
import {
  buildConfirmedOrderMessage,
  buildRescueOrderMessage,
  buildCartWhatsAppMessage,
  orderReferenceFromKey,
} from "@/lib/orders/orderMessage";
import type { CartItem } from "@/lib/cart/types";

/**
 * الرسالة التي وصلت فعلاً بعد الطلب TF-2026-0091.
 *
 * صفّ الطلب كان صحيحاً (delivery_fee = 0، final_total = 370)، لكن الرسالة
 * التي قرأها الزبون قالت «المجموع لا يشمل التوصيل — يُحسب بعد تجهيز
 * الطلب». السبب لم يكن في المولّد بل في نداء واحد لم يمرّر إعداد التوصيل:
 * `needsReview` كانت تفصل بين الحقول التي عُدِّلت، فبقي هذا النداء وحده
 * على الصيغة الافتراضية القديمة.
 *
 * ولذلك يشتري هذا الملف الشيء نفسه من الاتجاهين: **النصّ القديم ممنوع
 * تماماً** حين تكون الرسوم صفراً، في المولّدات الثلاثة بلا استثناء —
 * ونداءٌ ينسى تمرير الإعداد يسقط هنا لا في هاتف زبون.
 */
const OLD_PHRASES = ["المجموع لا يشمل التوصيل", "يُحسب بعد تجهيز الطلب"];

const item: CartItem = {
  productId: 1,
  variantId: null,
  slug: "r22-1kg",
  sku: "TF-AC-050",
  name: "غاز r22 1kg",
  variantName: null,
  unitPrice: 370,
  minOrderQty: 1,
  qtyIncrement: 1,
  imageUrl: null,
  quantity: 1,
};

const customer = {
  fullName: "اسماعيل",
  phone: "0669082281",
  city: "مراكش",
  address: "",
  notes: "",
};

const base = {
  storeName: "Tayssir Froid",
  reference: orderReferenceFromKey("54154136"),
  items: [item],
  subtotal: 370,
  whatsappNumber: "+212722083458",
};

describe("رسالة الطلب المؤكَّد — الحالة التي وقعت فعلاً", () => {
  const confirmed = (deliveryFeePerCartonMad: number, needsReview = false) =>
    buildConfirmedOrderMessage({
      ...base,
      customer,
      orderNumber: "TF-2026-0091",
      needsReview,
      deliveryFeePerCartonMad,
    });

  test("بتوصيل مجاني: الذيل الجديد كاملاً، بلا أثر للنصّ القديم", () => {
    const message = confirmed(0);

    expect(message).toContain("مجموع المنتجات: 370,00 درهم");
    expect(message).toContain("🚚 التوصيل: مجاناً");
    expect(message).toContain("المجموع النهائي: 370,00 درهم");
    expect(message).toContain("✅ الدفع عند الاستلام بعد معاينة السلعة");
    expect(message).toContain("🚚 التوصيل بالمجان لجميع مناطق المغرب");

    for (const phrase of OLD_PHRASES) expect(message).not.toContain(phrase);
  });

  test("برسوم قائمة: المنطق القديم يعود وحده", () => {
    const message = confirmed(30);
    expect(message).toContain("المجموع لا يشمل التوصيل");
    expect(message).not.toContain("مجاناً");
    expect(message).not.toContain("المجموع النهائي");
  });

  test("طلب ينتظر مراجعة مخزون لا يُسمّى مجموعه نهائياً", () => {
    const message = confirmed(0, true);
    expect(message).toContain("المجموع المطلوب قبل مراجعة المخزون");
    expect(message).toContain("🚚 التوصيل: مجاناً");
    // مبلغٌ قد يتغيّر بعد المراجعة لا يُعلَن نهائياً.
    expect(message).not.toContain("المجموع النهائي");
    for (const phrase of OLD_PHRASES) expect(message).not.toContain(phrase);
  });
});

describe("المولّدان الآخران يتبعان نفس القاعدة", () => {
  test("رسالة الإنقاذ", () => {
    const free = buildRescueOrderMessage({ ...base, customer, deliveryFeePerCartonMad: 0 });
    expect(free).toContain("🚚 التوصيل: مجاناً");
    expect(free).toContain("المجموع النهائي: 370,00 درهم");
    for (const phrase of OLD_PHRASES) expect(free).not.toContain(phrase);

    const paid = buildRescueOrderMessage({ ...base, customer, deliveryFeePerCartonMad: 30 });
    expect(paid).toContain("المجموع لا يشمل التوصيل");
  });

  test("رسالة السلة", () => {
    const free = buildCartWhatsAppMessage({ ...base, deliveryFeePerCartonMad: 0 });
    expect(free).toContain("🚚 التوصيل: مجاناً");
    expect(free).toContain("المجموع النهائي: 370,00 درهم");
    for (const phrase of OLD_PHRASES) expect(free).not.toContain(phrase);
    // وتبقى جملة إكمال الطلب في آخر الرسالة كما كانت.
    expect(free.trimEnd().endsWith("بغيت نكمل هاد الطلب. غادي نعطيكم الاسم والمدينة والهاتف هنا.")).toBe(true);

    const paid = buildCartWhatsAppMessage({ ...base, deliveryFeePerCartonMad: 30 });
    expect(paid).toContain("المجموع لا يشمل التوصيل");
  });
});
