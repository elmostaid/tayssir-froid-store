import { describe, expect, test } from "vitest";
import {
  isFreeDelivery,
  deliveryAmountLabel,
  totalDeliveryNote,
  FREE_DELIVERY_HEADLINE,
} from "@/lib/delivery";
import { FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { buildCartWhatsAppMessage, orderReferenceFromKey } from "@/lib/orders/orderMessage";
import type { CartItem } from "@/lib/cart/types";

/**
 * مجانية التوصيل قرارُ إعدادٍ لا قرارُ كود.
 *
 * الخطر الحقيقي في تغيير كهذا ليس أن تُنسى جملة، بل أن تُكتب «مجاناً»
 * نصّاً ثابتاً في اثني عشر موضعاً — فيصير الرجوع عن القرار مشروعاً كاملاً،
 * ويبقى حتماً موضعٌ يناقض البقية أمام الزبون. لذلك يتحقّق هذا الملف من
 * الاتجاهين معاً: صفرٌ يقول «مجاناً»، ورقمٌ موجب يُعيد الصيغة القديمة.
 */
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

describe("قرار مجانية التوصيل", () => {
  test("صفر = مجاني، والموجب ليس مجانياً", () => {
    expect(isFreeDelivery(0)).toBe(true);
    expect(isFreeDelivery(30)).toBe(false);
    expect(isFreeDelivery(45)).toBe(false);
  });

  test("قيمة غير صالحة تُعامَل كمجانية لا كرسوم مخترَعة", () => {
    expect(isFreeDelivery(Number.NaN)).toBe(true);
  });

  test("سطر الملخّص: «مجاناً» أو المبلغ", () => {
    expect(deliveryAmountLabel(0)).toBe("مجاناً");
    expect(deliveryAmountLabel(30)).toContain("30");
  });

  test("خاتمة المجموع تنقلب مع الإعداد", () => {
    expect(totalDeliveryNote(0)).toContain("المبلغ النهائي");
    expect(totalDeliveryNote(0)).not.toContain("لا يشمل");
    expect(totalDeliveryNote(30)).toContain("لا يشمل التوصيل");
  });

  test("الإعداد الاحتياطي مجاني أيضاً — عطل الشبكة لا يخترع رسوماً", () => {
    expect(FALLBACK_SETTINGS.deliveryFeePerCartonMad).toBe(0);
    expect(isFreeDelivery(FALLBACK_SETTINGS.deliveryFeePerCartonMad)).toBe(true);
  });
});

describe("رسالة واتساب تتبع نفس الإعداد", () => {
  const base = {
    storeName: "Tayssir Froid",
    reference: orderReferenceFromKey("aabbccdd"),
    items: [item],
    subtotal: 1000,
    whatsappNumber: "+212722083458",
  };

  test("بتوصيل مجاني: الرسالة تُنهي المبلغ ولا تَعِد بإضافة", () => {
    const message = buildCartWhatsAppMessage({ ...base, deliveryFeePerCartonMad: 0 });
    // الذيل الصريح (انظر orders/__tests__/freeDeliveryMessage.test.ts للتفصيل).
    expect(message).toContain("المجموع النهائي");
    expect(message).toContain("🚚 التوصيل: مجاناً");
    // ولا تَعِد الزبون بمبلغ إضافي لن يُضاف.
    expect(message).not.toContain("لا يشمل التوصيل");
  });

  test("برسوم قائمة: الصيغة القديمة تعود وحدها", () => {
    const message = buildCartWhatsAppMessage({ ...base, deliveryFeePerCartonMad: 30 });
    expect(message).toContain("لا يشمل التوصيل");
  });
});

describe("الجملة المعلنة", () => {
  test("موحَّدة في مصدر واحد وتذكر المغرب كله بلا شرط", () => {
    expect(FREE_DELIVERY_HEADLINE).toBe("التوصيل بالمجان لجميع مدن المغرب");
    expect(FREE_DELIVERY_HEADLINE).not.toMatch(/ابتداء|حد أدنى|شرط/);
  });
});
