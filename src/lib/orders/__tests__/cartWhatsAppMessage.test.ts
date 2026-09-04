import { describe, expect, test } from "vitest";
import {
  buildCartWhatsAppMessage,
  orderReferenceFromKey,
  randomOrderReference,
  MAX_WHATSAPP_URL_BYTES,
} from "@/lib/orders/orderMessage";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { formatMad } from "@/lib/format";
import type { CartItem } from "@/lib/cart/types";

const NUMBER = "+212722083458";

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: 1,
    variantId: null,
    slug: "gas-r410",
    sku: "TF-GAS-001",
    name: "غاز تبريد R410A قنينة 11 كغ",
    variantName: null,
    unitPrice: 1200,
    minOrderQty: 1,
    qtyIncrement: 1,
    imageUrl: null,
    quantity: 2,
    ...overrides,
  };
}

const BASE = {
  storeName: "Tayssir Froid",
  reference: orderReferenceFromKey("3f2a1b9c-0000-0000-0000-000000000000"),
  whatsappNumber: NUMBER,
};

/**
 * الرسالة التي يبنيها زرّ «أكمل الطلب عبر واتساب» من السلة.
 *
 * هذه الصيغة وُجدت لمن لا يملأ النموذج، فالخطر فيها مختلف عن أختيها:
 * لا اسم ولا هاتف ولا مدينة — والامتحان هو ألّا تكذب بحقول فارغة، وأن
 * تحمل ما لا يستطيع البائع استرجاعه من المحادثة (الطلبية والمرجع)، وألّا
 * تُنتج رابطاً يُسقط متصفّح فيسبوك مهما كبرت السلة.
 */
describe("buildCartWhatsAppMessage", () => {
  test("تحمل الطلبية والكميات والمجموع والمرجع", () => {
    const message = buildCartWhatsAppMessage({
      ...BASE,
      deliveryFeePerCartonMad: 30,
      items: [item(), item({ productId: 2, sku: "TF-GAS-002", name: "غاز R32", unitPrice: 900, quantity: 1 })],
      subtotal: 3300,
    });

    expect(message).toContain("Tayssir Froid");
    expect(message).toContain(BASE.reference);
    expect(message).toContain("غاز تبريد R410A");
    expect(message).toContain("× 2");
    expect(message).toContain("غاز R32");
    expect(message).toContain("2 منتجاً (3 قطعة)");
    expect(message).toContain(formatMad(3300));
  });

  test("لا تكتب حقول زبون فارغة — البيانات تُؤخذ في المحادثة", () => {
    const message = buildCartWhatsAppMessage({ deliveryFeePerCartonMad: 30, ...BASE, items: [item()], subtotal: 2400 });

    expect(message).not.toContain("الاسم الكامل:");
    expect(message).not.toContain("الهاتف:");
    expect(message).not.toContain("المدينة:");
    // وتقول صراحةً من أين ستأتي هذه البيانات، حتى لا يظنّ البائع أنها ضاعت.
    expect(message).toContain("الاسم والمدينة والهاتف");
  });

  test("تكتب سطر المصدر حين يُعرف، وتحذفه حين لا يُعرف", () => {
    const withSource = buildCartWhatsAppMessage({
      ...BASE,
      deliveryFeePerCartonMad: 30,
      items: [item()],
      subtotal: 2400,
      attributionNote: "facebook / cpc",
    });
    expect(withSource).toContain("المصدر: facebook / cpc");

    const withoutSource = buildCartWhatsAppMessage({ deliveryFeePerCartonMad: 30, ...BASE, items: [item()], subtotal: 2400 });
    expect(withoutSource).not.toContain("المصدر:");

    // مصدر بمسافات فقط لا يُنتج سطراً فارغاً.
    const blank = buildCartWhatsAppMessage({
      ...BASE,
      deliveryFeePerCartonMad: 30,
      items: [item()],
      subtotal: 2400,
      attributionNote: "   ",
    });
    expect(blank).not.toContain("المصدر:");
  });

  test("سلة ضخمة لا تُنتج رابطاً يتجاوز السقف", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      item({
        productId: i + 1,
        sku: `TF-LONG-${i}`,
        name: `منتج طويل الاسم جداً رقم ${i} لتبريد المكيفات والثلاجات والمجمّدات`,
        quantity: (i % 5) + 1,
      })
    );

    const message = buildCartWhatsAppMessage({
      ...BASE,
      deliveryFeePerCartonMad: 30,
      items: many,
      subtotal: 99_000,
      attributionNote: "facebook / cpc",
    });
    const link = buildWhatsAppLink(NUMBER, message);

    expect(link.length).toBeLessThanOrEqual(MAX_WHATSAPP_URL_BYTES);
    // وتبقى قابلة للتنفيذ: المرجع والمجموع حاضران، والباقي مُعلَن لا مسكوت عنه.
    expect(message).toContain(BASE.reference);
    expect(message).toContain(formatMad(99_000));
    expect(message).toMatch(/و\d+ منتجاً آخر/);
  });

  test("حتى حين لا يسع أي سطر، تبقى الرسالة صالحة بالمرجع والمجموع", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      item({ productId: i + 1, sku: `TF-X-${i}`, name: `منتج ${i}` })
    );

    const message = buildCartWhatsAppMessage({
      ...BASE,
      deliveryFeePerCartonMad: 30,
      items: many,
      subtotal: 12_000,
      maxUrlBytes: 400,
    });

    expect(message).toContain(BASE.reference);
    expect(message).toContain(formatMad(12_000));
    expect(message).toContain("60 منتجاً");
  });
});

/**
 * المرجع في هذا المسار يُولَّد في المتصفح بلا أي حفظ. والمتصفّح المقصود هو
 * تحديداً متصفّح فيسبوك الداخلي، حيث `crypto.randomUUID` قد يكون غائباً —
 * وغيابه يجب ألّا يُنتج استثناءً ولا مرجعاً فارغاً.
 */
describe("randomOrderReference", () => {
  test("مرجع بالشكل المتوقَّع، ومختلف في كل مرة", () => {
    const refs = new Set(Array.from({ length: 50 }, () => randomOrderReference()));
    for (const ref of refs) expect(ref).toMatch(/^W-[0-9A-F]{8}$/);
    // لا نطالب بـ50 قيمة مختلفة (التصادم ممكن نظرياً)، بل بأنها ليست ثابتة.
    expect(refs.size).toBeGreaterThan(40);
  });

  test("يعمل حين لا يوفّر المتصفح crypto.getRandomValues", () => {
    const original = globalThis.crypto;
    // نحاكي WebView قديماً: لا كائن crypto إطلاقاً.
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(randomOrderReference()).toMatch(/^W-[0-9A-F]{8}$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});
