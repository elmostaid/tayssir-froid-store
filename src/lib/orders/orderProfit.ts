import { deliveryMargin } from "@/lib/orders/deliveryCost";

/**
 * ربح الطلبية الواحدة — للعرض داخل صفحة الطلبية وحدها.
 *
 * هذا الملف **لا يكتب شيئاً ولا يُستورَد من أي كود تقارير**. صفحة التقارير
 * تبقى المصدر الوحيد للأرباح المحاسبية (طلبات `delivered` فقط)، وهذا الحساب
 * مشتقٌّ وقت القراءة لمتابعة طلبٍ بعينه. فلا ازدواج في العدّ: لا رقم هنا
 * يُضاف إلى أي مجموع هناك.
 *
 * ثلاثة مبادئ تحكم كل سطر تحته:
 *
 * 1. **المحجوز وحده بيعٌ.** السطر `out_of_stock` أو `invalid` لم يُخصَم من
 *    المخزون ولن يخرج من المحل، فحسابه بيعاً يخترع إيراداً. يُستثنى ويُعرَض
 *    عدده وقيمته على حدة بدل أن يختفي بلا أثر. (ملاحظة: `orders.items_subtotal`
 *    يجمع **كل** السطور، فقد يفوق مجموع البيع هنا — وهذا مقصود لا خطأ.)
 *
 * 2. **المجهول ليس صفراً.** تكلفةٌ لا نعرفها لا تُقرأ صفراً: الربح حينها
 *    يبدو كامل ثمن البيع، وهو كذبٌ مريح. فالسطر بلا أي تكلفة معروفة يُحتسَب
 *    `null`، ويُسحَب الربح كلَّه إلى `null` معه. ونفس القاعدة لتكلفة
 *    التوصيل — وهي الحالة الشائعة لا النادرة.
 *
 * 3. **التاريخ لا يتغيّر بأثر رجعي.** `purchase_price_snapshot` هو ثمن
 *    الشراء كما كان لحظة إنشاء الطلب، فتعديل ثمن المنتج في الكتالوغ اليوم
 *    لا يمسّ ربح طلبٍ قديم. حين يغيب ذلك الـsnapshot (طلبات قليلة سبقت
 *    هجرة 20260807000000، أو منتج لم يكن له ثمن شراء وقتها) نرجع لثمن اليوم
 *    **موسوماً تقديراً** — نفس ترتيب `orderCogsCte()` في adminReports.ts
 *    بالضبط، حتى لا يتناقض الرقمان على الطلب نفسه.
 */

/** هل الطلب بيعةٌ وقعت، أم متوقَّعة، أم لم تقع أصلاً؟ */
export type ProfitRealization = "expected" | "realized" | "not_a_sale";

/**
 * الإلغاء والإرجاع يُرجعان المخزون ولا يمسّان `line_status` إطلاقاً (لا
 * يوجد في الكود كلِّه أي كتابة على ذلك العمود بعد الإنشاء — راجع
 * `restockOrderInternal`). فالسطور تبقى `reserved` وتبقى تكلفتها محفوظة،
 * وربح الطلب المرجعي يظل معروضاً كما كان: نُعلِمه «لم تقع» بدل أن نُصفّره
 * أو نُخفيه. الفرق بين «ربحٌ لم يتحقّق» و«ربحٌ صفر» هو الفرق بين صفقةٍ
 * ضاعت وصفقةٍ لا ربح فيها.
 */
export function profitRealization(status: string): ProfitRealization {
  if (status === "delivered") return "realized";
  if (status === "cancelled" || status === "returned") return "not_a_sale";
  return "expected";
}

export const PROFIT_REALIZATION_LABELS: Record<ProfitRealization, string> = {
  expected: "ربح متوقَّع",
  realized: "ربح محقَّق",
  not_a_sale: "لم تقع البيعة",
};

export type OrderProfitLine = {
  quantity: number;
  /** ثمن البيع وقت الطلب. */
  unitPrice: string | number | null;
  /** ثمن الشراء وقت الطلب — المصدر الوحيد الدقيق. */
  purchasePriceSnapshot: string | number | null;
  /** ثمن الشراء **اليوم**، للتقدير وحده حين يغيب الـsnapshot. */
  currentPurchasePrice: string | number | null;
  lineStatus: string;
};

export type OrderProfitInput = {
  status: string;
  lines: OrderProfitLine[];
  /** ما حصّلناه من الزبون على التوصيل. */
  deliveryFee: string | number | null;
  /** ما دفعناه لشركة التوصيل. null = غير مسجَّلة، وليس صفراً. */
  actualDeliveryCost: string | number | null;
};

export type OrderProfit = {
  realization: ProfitRealization;
  /** مجموع بيع السطور المحجوزة. */
  salesMad: number;
  /** تكلفة شرائها. `null` = سطرٌ واحد على الأقل بلا أي تكلفة معروفة. */
  cogsMad: number | null;
  /** البيع − التكلفة. `null` متى كانت التكلفة `null`. */
  grossProfitMad: number | null;
  deliveryCollectedMad: number;
  /** `null` = غير مسجَّلة. */
  deliveryCostMad: number | null;
  /** المحصَّل − المدفوع. `null` = غير مسجَّلة. */
  deliveryMarginMad: number | null;
  /** الربح الخام + فرق التوصيل. `null` إن غاب أيُّ طرف منهما. */
  netProfitMad: number | null;
  /** سطرٌ واحد على الأقل اعتمد ثمن اليوم بدل الـsnapshot. */
  isEstimate: boolean;
  /** سطور محجوزة اعتمدت ثمن اليوم. */
  linesEstimated: number;
  /** سطور محجوزة بلا أي تكلفة معروفة إطلاقاً. */
  linesWithoutCost: number;
  /** سطور غير محجوزة، مستثناة من البيع. */
  excludedLines: number;
  excludedSalesMad: number;
  reservedLines: number;
};

function toNumber(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeOrderProfit(input: OrderProfitInput): OrderProfit {
  const reserved = input.lines.filter((line) => line.lineStatus === "reserved");
  const excluded = input.lines.filter((line) => line.lineStatus !== "reserved");

  let salesMad = 0;
  let cogsKnown = 0;
  let linesEstimated = 0;
  let linesWithoutCost = 0;

  for (const line of reserved) {
    const quantity = toNumber(line.quantity) ?? 0;
    salesMad += (toNumber(line.unitPrice) ?? 0) * quantity;

    const snapshot = toNumber(line.purchasePriceSnapshot);
    if (snapshot !== null) {
      cogsKnown += snapshot * quantity;
      continue;
    }

    // نفس ترتيب الرجوع في orderCogsCte()، ناقصَ الصفر الأخير: هناك يُسكِت
    // الصفرُ المجاميعَ الكبيرة، وهنا يكذب على طلبٍ واحد بعينه.
    const fallback = toNumber(line.currentPurchasePrice);
    if (fallback === null) {
      linesWithoutCost += 1;
      continue;
    }
    cogsKnown += fallback * quantity;
    linesEstimated += 1;
  }

  const cogsMad = linesWithoutCost > 0 ? null : round2(cogsKnown);
  salesMad = round2(salesMad);
  const grossProfitMad = cogsMad === null ? null : round2(salesMad - cogsMad);

  const deliveryCostMad = toNumber(input.actualDeliveryCost);
  const deliveryCollectedMad = toNumber(input.deliveryFee) ?? 0;
  const deliveryMarginMad = deliveryMargin({
    deliveryFee: input.deliveryFee,
    actualDeliveryCost: input.actualDeliveryCost,
  });

  const netProfitMad =
    grossProfitMad === null || deliveryMarginMad === null
      ? null
      : round2(grossProfitMad + deliveryMarginMad);

  return {
    realization: profitRealization(input.status),
    salesMad,
    cogsMad,
    grossProfitMad,
    deliveryCollectedMad: round2(deliveryCollectedMad),
    deliveryCostMad,
    deliveryMarginMad,
    netProfitMad,
    isEstimate: linesEstimated > 0,
    linesEstimated,
    linesWithoutCost,
    excludedLines: excluded.length,
    excludedSalesMad: round2(
      excluded.reduce(
        (sum, line) => sum + (toNumber(line.unitPrice) ?? 0) * (toNumber(line.quantity) ?? 0),
        0
      )
    ),
    reservedLines: reserved.length,
  };
}
