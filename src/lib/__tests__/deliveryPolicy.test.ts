import { describe, expect, test } from "vitest";
import {
  DELIVERY_AVAILABILITY,
  DELIVERY_COST_TIMING,
  deliveryStatusLabel,
  totalDeliveryNote,
} from "@/lib/delivery";
import { buildCartWhatsAppMessage, orderReferenceFromKey } from "@/lib/orders/orderMessage";
import type { CartItem } from "@/lib/cart/types";

/**
 * سياسة التوصيل: توفّرٌ بلا ثمن وبلا وعد بالمجانية.
 *
 * الخطر في تغيير كهذا ليس أن تُنسى جملة واحدة، بل أن ينجو **طريق** يُخرج
 * مبلغاً أو كلمة «مجاناً» إلى عين الزبون من موضع لم يخطر ببال أحد. لذلك
 * يتحقّق هذا الملفّ من الممنوع لا من المسموح وحده: لا رقم، ولا «مجان»،
 * في أي نصّ يراه الزبون.
 */
const FORBIDDEN = /مجان|بالمجان|free\s*shipping|gratuit/i;
/** أي مبلغ بالدرهم — الرسوم القديمة (30/45) أو غيرها. */
const ANY_AMOUNT = /\d[\d\s.,]*\s*(درهم|MAD|د\.م)/i;

const item: CartItem = {
  productId: 1,
  variantId: null,
  slug: "x",
  sku: "TF-X-001",
  name: "قطعة",
  variantName: null,
  unitPrice: 500,
  minOrderQty: 1,
  qtyIncrement: 1,
  imageUrl: null,
  quantity: 2,
};

describe("نصوص سياسة التوصيل", () => {
  test("الجملة المعلنة: توفّر لجميع مناطق المغرب، بلا شرط وبلا ثمن", () => {
    expect(DELIVERY_AVAILABILITY).toBe("التوصيل متوفر لجميع مناطق المغرب");
    expect(DELIVERY_AVAILABILITY).not.toMatch(FORBIDDEN);
    expect(DELIVERY_AVAILABILITY).not.toMatch(ANY_AMOUNT);
  });

  test("وقت تحديد المصاريف يُذكر، ومقدارها لا يُذكر", () => {
    expect(DELIVERY_COST_TIMING).toContain("تُحدَّد");
    expect(DELIVERY_COST_TIMING).not.toMatch(FORBIDDEN);
    expect(DELIVERY_COST_TIMING).not.toMatch(ANY_AMOUNT);
  });

  test("سطر الملخّص يحمل حالة لا مبلغاً", () => {
    expect(deliveryStatusLabel()).toBe("يُحدَّد عند التأكيد");
    expect(deliveryStatusLabel()).not.toMatch(ANY_AMOUNT);
  });

  test("خاتمة المجموع تتحفّظ ولا تَعِد بمبلغ نهائي", () => {
    const note = totalDeliveryNote();
    expect(note).toContain("لا يشمل");
    expect(note).not.toMatch(FORBIDDEN);
    expect(note).not.toMatch(ANY_AMOUNT);
  });
});

describe("رسالة واتساب من السلة", () => {
  const base = {
    storeName: "Tayssir Froid",
    reference: orderReferenceFromKey("aabbccdd"),
    items: [item],
    subtotal: 1000,
    whatsappNumber: "+212722083458",
  };

  test("لا تَعِد بمجانية ولا تسمّي المبلغ نهائياً", () => {
    const message = buildCartWhatsAppMessage(base);
    expect(message).toContain("مجموع المنتجات");
    expect(message).not.toMatch(FORBIDDEN);
    expect(message).not.toContain("المجموع النهائي");
    expect(message).toContain(DELIVERY_AVAILABILITY);
    expect(message).toContain("لا يشمل");
  });

  test("لا يظهر أي ثمن توصيل — 30 ولا 45 ولا غيرهما", () => {
    const message = buildCartWhatsAppMessage(base);
    // مبلغ المنتجات وحده مسموح؛ نحذفه ثم نتأكّد ألّا يبقى مبلغ آخر.
    const withoutSubtotal = message.split("\n").filter((l) => !l.includes("مجموع المنتجات"));
    for (const line of withoutSubtotal) {
      expect(line).not.toMatch(ANY_AMOUNT);
    }
  });
});
