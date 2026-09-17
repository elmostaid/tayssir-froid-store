import { describe, expect, test } from "vitest";
import {
  buildConfirmedOrderMessage,
  buildRescueOrderMessage,
  buildCartWhatsAppMessage,
  orderReferenceFromKey,
} from "@/lib/orders/orderMessage";
import { DELIVERY_AVAILABILITY } from "@/lib/delivery";
import type { CartItem } from "@/lib/cart/types";

/**
 * ما تقوله رسالة واتساب عن التوصيل — في المولّدات الثلاثة بلا استثناء.
 *
 * هذا الملفّ وُلد من عطبٍ حقيقي: الطلب TF-2026-0091 وصل صاحبه برسالة
 * تناقض ما في قاعدة البيانات، لأن نداءً واحداً من ثلاثة لم يمرّر إعداد
 * التوصيل. ومنذ ذلك اليوم قاعدته أن يشتري الشيء نفسه من المولّدات
 * الثلاثة، لا من واحد ويُفترض الباقي.
 *
 * وقد تبدّل ما يُشترى: لم يعد المطلوب أن تقول الرسالة «مجاناً» بل ألّا
 * تقولها أبداً، ولا تسمّي المبلغ نهائياً، ولا تذكر رقماً للتوصيل. لذلك
 * الفحص على الممنوع أساساً — فالوعد المحذوف يعود من أي سطر يُنسى.
 */
const FORBIDDEN = /مجان|بالمجان|free\s*shipping|gratuit/i;
const FINAL_CLAIM = "المجموع النهائي";

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

const builders: Array<[string, () => string]> = [
  [
    "الطلب المؤكَّد",
    () => buildConfirmedOrderMessage({ ...base, customer, orderNumber: "TF-2026-0091" }),
  ],
  ["طلب الإنقاذ", () => buildRescueOrderMessage({ ...base, customer })],
  ["زرّ السلة", () => buildCartWhatsAppMessage(base)],
];

describe.each(builders)("%s", (_name, build) => {
  test("لا يَعِد بمجانية التوصيل", () => {
    expect(build()).not.toMatch(FORBIDDEN);
  });

  test("لا يسمّي المبلغ نهائياً ما دامت المصاريف غير محدَّدة", () => {
    expect(build()).not.toContain(FINAL_CLAIM);
  });

  test("يقول أين نصل، ويتحفّظ صراحةً على ما لا يشمله المبلغ", () => {
    const message = build();
    expect(message).toContain(DELIVERY_AVAILABILITY);
    expect(message).toContain("لا يشمل");
  });

  test("لا يذكر أي ثمن للتوصيل — ولا 30 ولا 45 ولا غيرهما", () => {
    // مبلغ المنتجات وحده مسموح؛ نُقصيه ثم نتأكّد ألّا يبقى مبلغ آخر.
    const rest = build()
      .split("\n")
      .filter((line) => !line.includes("مجموع المنتجات") && !line.includes(item.name));
    for (const line of rest) {
      expect(line).not.toMatch(/\d[\d\s.,]*\s*(درهم|MAD)/i);
    }
  });
});

describe("الطلب المنتظِر مراجعة المخزون", () => {
  test("يحتفظ بتسميته المتحفّظة ولا يعود إلى «النهائي»", () => {
    const message = buildConfirmedOrderMessage({
      ...base,
      customer,
      orderNumber: "TF-2026-0091",
      needsReview: true,
    });
    expect(message).toContain("قبل مراجعة المخزون");
    expect(message).not.toContain(FINAL_CLAIM);
    expect(message).not.toMatch(FORBIDDEN);
  });
});
