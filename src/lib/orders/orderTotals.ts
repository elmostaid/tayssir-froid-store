/**
 * المبلغ الذي يدفعه الزبون فعلاً.
 *
 * في جدول الطلبات ثلاثة أرقام يسهل الخلط بينها، وقد وقع الخلط فعلاً:
 * `items_subtotal` مجموع المنتجات وحدها، و`delivery_fee` ما يدفعه الزبون
 * للتوصيل، و`final_total` مجموعهما — وهو الوحيد الذي يساوي ما سيُسلَّم
 * نقداً عند الاستلام.
 *
 * بطاقة الطلب في /admin/orders كانت تعرض `items_subtotal` تحت رقم يقرأه
 * صاحب المتجر على أنه «قيمة الطلب»، فظهر طلب حقيقي بـ1850 درهم بينما
 * الزبون يدفع 1895. الرقم لم يكن خاطئاً في القاعدة؛ كان الخطأ في أيّ
 * الأعمدة يُعرض.
 *
 * التراجع إلى `items_subtotal` ليس تجميلاً: طلبات الموقع تُنشأ بلا مصاريف
 * توصيل (يحدّدها المدير بعد أن يعرف عدد الكراتين)، فيبقى `final_total`
 * فارغاً حتى ذلك الحين. عرض شرطة مكان المبلغ في تلك الفترة أسوأ من عرض
 * مجموع المنتجات، فنعرضه ونُسمّيه بما هو.
 */

export type OrderTotalsShape = {
  itemsSubtotal: string | number;
  finalTotal: string | number | null;
};

/** المبلغ المستحق على الزبون: الإجمالي إن حُسم، وإلا مجموع المنتجات. */
export function orderPayableTotal(order: OrderTotalsShape): number {
  const final = order.finalTotal === null ? null : Number(order.finalTotal);
  if (final !== null && Number.isFinite(final)) return final;
  return Number(order.itemsSubtotal) || 0;
}

/** هل الرقم أعلاه نهائي، أم مؤقّت لأن التوصيل لم يُحدَّد بعد؟ */
export function isPayableTotalFinal(order: OrderTotalsShape): boolean {
  return order.finalTotal !== null && Number.isFinite(Number(order.finalTotal));
}
