import { describe, expect, test } from "vitest";
import { isPayableTotalFinal, orderPayableTotal } from "@/lib/orders/orderTotals";

/**
 * الحالة الحقيقية التي كشفت العطل: TF-2026-0030 — منتجات 1850، توصيل 45،
 * والزبون يدفع 1895. بطاقة الطلب كانت تعرض 1850.
 */
describe("مبلغ الطلب المستحق على الزبون", () => {
  test("يعرض الإجمالي شاملاً التوصيل، لا مجموع المنتجات", () => {
    expect(orderPayableTotal({ itemsSubtotal: "1850.00", finalTotal: "1895.00" })).toBe(1895);
  });

  test("طلب موقع لم يُحدَّد توصيله بعد: يتراجع لمجموع المنتجات ويُعلن أنه غير نهائي", () => {
    const order = { itemsSubtotal: "1850.00", finalTotal: null };
    expect(orderPayableTotal(order)).toBe(1850);
    expect(isPayableTotalFinal(order)).toBe(false);
  });

  test("توصيل صفر: الإجمالي يساوي مجموع المنتجات، ويبقى نهائياً", () => {
    const order = { itemsSubtotal: 600, finalTotal: 600 };
    expect(orderPayableTotal(order)).toBe(600);
    expect(isPayableTotalFinal(order)).toBe(true);
  });

  test("قيمة تالفة لا تُنتج NaN على الشاشة", () => {
    expect(orderPayableTotal({ itemsSubtotal: "غير رقم", finalTotal: "غير رقم" })).toBe(0);
  });
});
