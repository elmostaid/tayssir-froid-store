/**
 * تكلفة التوصيل الفعلية، وفرقها عمّا حصّلناه من الزبون.
 *
 * في الطلب رقمان للتوصيل لا واحد، والخلط بينهما يُنتج ربحاً وهمياً:
 *
 *   delivery_fee          ما دفعه **الزبون** لنا      (إيراد)
 *   actual_delivery_cost  ما دفعناه **نحن** للشركة    (مصروف)
 *
 * وفرقهما هو ما يربحه المتجر أو يخسره على التوصيل وحده:
 *
 *   دفع 30 وكلّفنا 45  →  −15   (نتحمّل الفرق)
 *   دفع  0 وكلّفنا 45  →  −45   (توصيل مجاني للزبون)
 *   دفع 45 وكلّفنا 45  →    0   (تمريرة بلا ربح ولا خسارة)
 *   دفع 45 وكلّفنا 35  →  +10   (فائض)
 *
 * **NULL ليس صفراً، وهذا هو القرار المركزي في هذا الملف كلّه.** طلب بلا
 * تكلفة مسجَّلة ليس طلباً كلّفنا صفر درهم — هو طلب لا نعرف كم كلّفنا.
 * فالدوال هنا تُرجع `null` لفرقه بدل رقم، والمجاميع في التقارير تستثنيه
 * وتعدّه على حدة. أرخص ثمناً أن يقول التقرير «تكلفة التوصيل غير مسجَّلة في
 * 12 طلباً» من أن يعرض صافي ربح واثقاً وكاذباً.
 */

/** أقصى تكلفة مقبولة — مطابق لقيد CHECK في القاعدة عمداً. */
export const MAX_DELIVERY_COST_MAD = 9_999_999;

export type DeliveryAmountsShape = {
  /** المحصَّل من الزبون. null = لم تُحدَّد مصاريف التوصيل بعد. */
  deliveryFee: string | number | null;
  /** المدفوع لشركة التوصيل. null = غير مسجَّلة. */
  actualDeliveryCost: string | number | null;
};

function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * فرق التوصيل = المحصَّل − التكلفة الفعلية.
 *
 * يُرجع `null` حين لا تكون التكلفة مسجَّلة — لا صفراً. أما `delivery_fee`
 * الفارغ (طلب موقع لم يُحدَّد توصيله بعد) فيُقرأ صفراً بحق: الزبون لم
 * يُطالَب بشيء حتى الآن، فما حصّلناه صفر فعلاً.
 */
export function deliveryMargin(order: DeliveryAmountsShape): number | null {
  const cost = toNumber(order.actualDeliveryCost);
  if (cost === null) return null;
  const fee = toNumber(order.deliveryFee) ?? 0;
  return Math.round((fee - cost) * 100) / 100;
}

/** هل سُجِّلت تكلفة هذا الطلب فعلاً؟ */
export function hasRecordedDeliveryCost(order: DeliveryAmountsShape): boolean {
  return toNumber(order.actualDeliveryCost) !== null;
}

export type ParsedDeliveryCost =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

/**
 * يقرأ ما كتبه الموظف في الخانة.
 *
 * الفراغ ليس خطأً ولا صفراً: هو **مسح** للقيمة وعودة إلى «غير مسجَّلة» —
 * الموظف الذي أدخل رقماً خاطئاً يحتاج طريقاً للتراجع، وإجباره على كتابة
 * صفر كان سيحوّل خطأً مطبعياً إلى ادّعاء مالي.
 */
export function parseDeliveryCostInput(raw: string): ParsedDeliveryCost {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, message: "تكلفة التوصيل الفعلية يجب أن تكون رقماً." };
  }
  if (value < 0) {
    return { ok: false, message: "تكلفة التوصيل الفعلية لا يمكن أن تكون سالبة." };
  }
  if (value > MAX_DELIVERY_COST_MAD) {
    return { ok: false, message: "تكلفة التوصيل الفعلية كبيرة جداً — تأكّد من الرقم." };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}
