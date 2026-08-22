import type { OrderLine } from "@/lib/orders/orderLines";

/**
 * حارس البيع تحت التكلفة.
 *
 * البيع بخسارة قرارٌ مشروع أحياناً — تصفية بضاعة راكدة، أو وعدٌ لزبون قديم.
 * لكنه في الغالب **خطأ إدخال**: رقم نُسخ من سطر آخر، أو صفر ضاع. الفرق بين
 * الحالتين لا يعرفه النظام، يعرفه صاحب المتجر وحده. فلا نمنع ولا نسمح
 * بصمت: نُري الخسارة بالاسم والمبلغ، ونطلب إقراراً صريحاً.
 *
 * والإقرار يُفحَص في **الخادم** لا في المتصفح: مربّع اختيار في صفحة ليس
 * حماية، وأي استدعاء مباشر للإجراء كان سيتجاوزه.
 *
 * التكلفة المجهولة ليست خسارة: سطر بلا ثمن شراء مسجَّل لا يُقارَن بشيء،
 * فيمرّ بلا حارس — لأن ادّعاء الخسارة بلا دليل مثل إنكارها بلا دليل.
 */

export type BelowCostLine = {
  nameSnapshot: string;
  skuSnapshot: string;
  unitPrice: number;
  purchasePrice: number;
  quantity: number;
  /** الخسارة في القطعة الواحدة. */
  lossPerUnit: number;
  /** الخسارة في السطر كله. */
  lossTotal: number;
};

export function findBelowCostLines(lines: OrderLine[]): BelowCostLine[] {
  const below: BelowCostLine[] = [];
  for (const line of lines) {
    const cost = line.purchasePriceSnapshot;
    // تساوي الثمنين ربحٌ صفر لا خسارة، فلا يستحقّ حارساً.
    if (cost === null || !Number.isFinite(cost) || line.unitPrice >= cost) continue;

    const lossPerUnit = cost - line.unitPrice;
    below.push({
      nameSnapshot: line.nameSnapshot,
      skuSnapshot: line.skuSnapshot,
      unitPrice: line.unitPrice,
      purchasePrice: cost,
      quantity: line.quantity,
      lossPerUnit,
      lossTotal: lossPerUnit * line.quantity,
    });
  }
  return below;
}

/** رسالة واحدة تجمع كل السطور الخاسرة بأسمائها ومبالغها. */
export function belowCostMessage(lines: BelowCostLine[]): string {
  const details = lines
    .map(
      (line) =>
        `"${line.nameSnapshot}" (بيع ${line.unitPrice} · شراء ${line.purchasePrice} — خسارة ${line.lossPerUnit} في القطعة، ${line.lossTotal} في السطر)`
    )
    .join("، ");

  return (
    `${lines.length === 1 ? "منتج يُباع" : `${lines.length} منتجات تُباع`} تحت ثمن الشراء: ${details}. ` +
    "لإتمام الطلب، أكّد صراحةً أنك تقصد البيع بخسارة."
  );
}
