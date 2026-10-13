import { describe, expect, it } from "vitest";
import {
  computeOrderProfit,
  profitRealization,
  type OrderProfitLine,
} from "@/lib/orders/orderProfit";

function line(over: Partial<OrderProfitLine> = {}): OrderProfitLine {
  return {
    quantity: 1,
    unitPrice: "100.00",
    purchasePriceSnapshot: "60.00",
    currentPurchasePrice: "70.00",
    lineStatus: "reserved",
    ...over,
  };
}

describe("profitRealization", () => {
  it("يميّز المحقَّق عن المتوقَّع عن ما لم يقع", () => {
    expect(profitRealization("delivered")).toBe("realized");
    expect(profitRealization("cancelled")).toBe("not_a_sale");
    expect(profitRealization("returned")).toBe("not_a_sale");
    for (const status of ["new", "needs_review", "contacted", "confirmed", "preparing", "shipped"]) {
      expect(profitRealization(status)).toBe("expected");
    }
  });
});

describe("computeOrderProfit — الحساب الأساسي", () => {
  it("يعتمد الـsnapshot لا ثمن اليوم، فلا يتغيّر ربح طلب قديم", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [line({ quantity: 2, unitPrice: "100", purchasePriceSnapshot: "60", currentPurchasePrice: "95" })],
      deliveryFee: "35",
      actualDeliveryCost: "40",
    });
    // 60 لا 95: ثمن الشراء وقت الطلب هو المرجع.
    expect(p.cogsMad).toBe(120);
    expect(p.salesMad).toBe(200);
    expect(p.grossProfitMad).toBe(80);
    expect(p.isEstimate).toBe(false);
  });

  it("فرق التوصيل يدخل الربح بعد المصاريف، وقد يكون سالباً", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [line({ unitPrice: "100", purchasePriceSnapshot: "60" })],
      deliveryFee: "35",
      actualDeliveryCost: "45",
    });
    expect(p.grossProfitMad).toBe(40);
    expect(p.deliveryMarginMad).toBe(-10);
    expect(p.netProfitMad).toBe(30);
  });

  it("يرصد البيع تحت التكلفة بربح خام سالب", () => {
    const p = computeOrderProfit({
      status: "confirmed",
      lines: [line({ unitPrice: "40", purchasePriceSnapshot: "60" })],
      deliveryFee: "0",
      actualDeliveryCost: "0",
    });
    expect(p.grossProfitMad).toBe(-20);
  });
});

describe("computeOrderProfit — المحجوز وحده بيع", () => {
  it("يستثني السطور غير المحجوزة ويُظهر عددها وقيمتها", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [
        line({ unitPrice: "100", purchasePriceSnapshot: "60" }),
        line({ unitPrice: "350", purchasePriceSnapshot: "200", lineStatus: "out_of_stock" }),
        line({ unitPrice: "50", purchasePriceSnapshot: "30", lineStatus: "invalid" }),
      ],
      deliveryFee: "35",
      actualDeliveryCost: "35",
    });
    expect(p.reservedLines).toBe(1);
    expect(p.salesMad).toBe(100);
    expect(p.cogsMad).toBe(60);
    expect(p.excludedLines).toBe(2);
    expect(p.excludedSalesMad).toBe(400);
  });

  it("طلب كل سطوره غير محجوزة: بيع صفر لا ربح وهمي", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [line({ unitPrice: "350", lineStatus: "out_of_stock" })],
      deliveryFee: "0",
      actualDeliveryCost: "0",
    });
    expect(p.salesMad).toBe(0);
    expect(p.cogsMad).toBe(0);
    expect(p.grossProfitMad).toBe(0);
    expect(p.excludedSalesMad).toBe(350);
  });
});

describe("computeOrderProfit — المجهول ليس صفراً", () => {
  it("يرجع لثمن اليوم حين يغيب الـsnapshot، ويسم النتيجة تقديرية", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [
        line({ unitPrice: "100", purchasePriceSnapshot: "60" }),
        line({ unitPrice: "320", purchasePriceSnapshot: null, currentPurchasePrice: "210" }),
      ],
      deliveryFee: "35",
      actualDeliveryCost: "35",
    });
    expect(p.cogsMad).toBe(270);
    expect(p.grossProfitMad).toBe(150);
    expect(p.isEstimate).toBe(true);
    expect(p.linesEstimated).toBe(1);
    expect(p.linesWithoutCost).toBe(0);
  });

  it("تكلفة مجهولة تماماً تُبطل الربح بدل أن تُقرأ صفراً", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [line({ unitPrice: "100", purchasePriceSnapshot: null, currentPurchasePrice: null })],
      deliveryFee: "35",
      actualDeliveryCost: "35",
    });
    expect(p.cogsMad).toBeNull();
    expect(p.grossProfitMad).toBeNull();
    expect(p.netProfitMad).toBeNull();
    expect(p.linesWithoutCost).toBe(1);
    // البيع يبقى معروفاً: المجهول هو التكلفة وحدها.
    expect(p.salesMad).toBe(100);
  });

  it("تكلفة توصيل غير مسجَّلة تُبقي الربح بعد المصاريف مجهولاً، لا مساوياً للخام", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [line({ unitPrice: "100", purchasePriceSnapshot: "60" })],
      deliveryFee: "35",
      actualDeliveryCost: null,
    });
    expect(p.grossProfitMad).toBe(40);
    expect(p.deliveryCostMad).toBeNull();
    expect(p.deliveryMarginMad).toBeNull();
    expect(p.netProfitMad).toBeNull();
  });

  it("delivery_fee فارغ يُقرأ صفراً بحق — الزبون لم يُطالَب بشيء", () => {
    const p = computeOrderProfit({
      status: "new",
      lines: [line({ unitPrice: "100", purchasePriceSnapshot: "60" })],
      deliveryFee: null,
      actualDeliveryCost: "45",
    });
    expect(p.deliveryCollectedMad).toBe(0);
    expect(p.deliveryMarginMad).toBe(-45);
    expect(p.netProfitMad).toBe(-5);
  });
});

describe("computeOrderProfit — الحالات الثماني كلها", () => {
  const lines = [line({ quantity: 3, unitPrice: "100", purchasePriceSnapshot: "60" })];

  it("لا يختفي الربح ولا يُصفَّر في أي حالة، بما فيها الملغاة والراجعة", () => {
    for (const status of [
      "new",
      "needs_review",
      "contacted",
      "confirmed",
      "preparing",
      "shipped",
      "delivered",
      "cancelled",
      "returned",
    ]) {
      const p = computeOrderProfit({
        status,
        lines,
        deliveryFee: "35",
        actualDeliveryCost: "35",
      });
      expect(p.salesMad, status).toBe(300);
      expect(p.cogsMad, status).toBe(180);
      expect(p.grossProfitMad, status).toBe(120);
      expect(p.netProfitMad, status).toBe(120);
    }
  });

  it("الملغاة والراجعة توسَم not_a_sale مع بقاء أرقامها كاملة", () => {
    for (const status of ["cancelled", "returned"]) {
      const p = computeOrderProfit({ status, lines, deliveryFee: "35", actualDeliveryCost: "35" });
      expect(p.realization).toBe("not_a_sale");
      expect(p.grossProfitMad).toBe(120);
    }
  });
});

describe("computeOrderProfit — مطابقة صيغة التقارير", () => {
  // orderCogsCte(): sum(quantity * coalesce(snapshot, variant_override,
  // product_price, 0)). نتحقق أن ترتيب الرجوع نفسه، والفرق الوحيد المقصود
  // هو الصفر الأخير (التقارير تُسكِته في مجاميع كبيرة، وهنا نرفضه لطلب واحد).
  it("يطابق COGS التقارير حين تكون كل التكاليف معروفة", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [
        line({ quantity: 5, unitPrice: "25", purchasePriceSnapshot: "15" }),
        line({ quantity: 10, unitPrice: "13", purchasePriceSnapshot: "8" }),
        line({ quantity: 10, unitPrice: "7", purchasePriceSnapshot: "4" }),
      ],
      deliveryFee: "35",
      actualDeliveryCost: null,
    });
    expect(p.salesMad).toBe(5 * 25 + 10 * 13 + 10 * 7); // 325
    expect(p.cogsMad).toBe(5 * 15 + 10 * 8 + 10 * 4); // 195
    expect(p.grossProfitMad).toBe(130);
  });

  it("يقرأ الأرقام النصّية من postgres بلا فقدان قروش", () => {
    const p = computeOrderProfit({
      status: "delivered",
      lines: [line({ quantity: 3, unitPrice: "19.99", purchasePriceSnapshot: "12.33" })],
      deliveryFee: "0.00",
      actualDeliveryCost: "0.00",
    });
    expect(p.salesMad).toBe(59.97);
    expect(p.cogsMad).toBe(36.99);
    expect(p.grossProfitMad).toBe(22.98);
  });
});
