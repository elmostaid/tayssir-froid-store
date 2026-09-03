import { describe, expect, test } from "vitest";
import {
  deliveryMargin,
  hasRecordedDeliveryCost,
  parseDeliveryCostInput,
  MAX_DELIVERY_COST_MAD,
} from "@/lib/orders/deliveryCost";

/**
 * الحسابات التي يقوم عليها «صافي أثر التوصيل».
 *
 * الحالة الخامسة (NULL) هي سبب وجود هذا الملف أصلاً: الأربع الأولى حسابٌ
 * بسيط، أما الخامسة فقرارٌ مالي — طلب لا نعرف تكلفة توصيله يجب ألّا يُنتج
 * رقماً إطلاقاً، لا صفراً ولا فرقاً موجباً يساوي كل ما حصّلناه.
 */
describe("فرق التوصيل لكل طلب", () => {
  test("الزبون دفع 30 والتكلفة 45 → −15", () => {
    expect(deliveryMargin({ deliveryFee: 30, actualDeliveryCost: 45 })).toBe(-15);
  });

  test("الزبون دفع 0 والتكلفة 45 → −45 (توصيل مجاني نتحمّله)", () => {
    expect(deliveryMargin({ deliveryFee: 0, actualDeliveryCost: 45 })).toBe(-45);
  });

  test("الزبون دفع 45 والتكلفة 45 → 0 (تمريرة)", () => {
    expect(deliveryMargin({ deliveryFee: 45, actualDeliveryCost: 45 })).toBe(0);
  });

  test("الزبون دفع 45 والتكلفة 35 → +10 (فائض)", () => {
    expect(deliveryMargin({ deliveryFee: 45, actualDeliveryCost: 35 })).toBe(10);
  });

  test("التكلفة غير مسجَّلة → null، ولا يجوز أن تصير صفراً", () => {
    const margin = deliveryMargin({ deliveryFee: 30, actualDeliveryCost: null });
    expect(margin).toBeNull();
    // الحارس الحقيقي: لو رجعت الدالة يوماً 0 أو 30 بدل null، هذان يسقطان.
    expect(margin).not.toBe(0);
    expect(margin).not.toBe(30);
  });

  test("القيم تصل نصوصاً من Postgres numeric وتُحسَب كأرقام", () => {
    expect(deliveryMargin({ deliveryFee: "30.00", actualDeliveryCost: "45.00" })).toBe(-15);
    expect(deliveryMargin({ deliveryFee: "45.50", actualDeliveryCost: "35.25" })).toBe(10.25);
  });

  test("مصاريف توصيل غير محدَّدة بعد تُقرأ صفراً — الزبون لم يُطالَب بشيء", () => {
    expect(deliveryMargin({ deliveryFee: null, actualDeliveryCost: 45 })).toBe(-45);
  });

  test("hasRecordedDeliveryCost يفصل المسجَّل عن غيره", () => {
    expect(hasRecordedDeliveryCost({ deliveryFee: 30, actualDeliveryCost: 0 })).toBe(true);
    expect(hasRecordedDeliveryCost({ deliveryFee: 30, actualDeliveryCost: "45.00" })).toBe(true);
    expect(hasRecordedDeliveryCost({ deliveryFee: 30, actualDeliveryCost: null })).toBe(false);
  });
});

describe("قراءة ما يكتبه الموظف", () => {
  test("رقم صالح يُقبَل ويُقرَّب إلى سنتيمين", () => {
    expect(parseDeliveryCostInput("45")).toEqual({ ok: true, value: 45 });
    expect(parseDeliveryCostInput(" 45.256 ")).toEqual({ ok: true, value: 45.26 });
  });

  test("الفراغ يمسح القيمة ويعيدها إلى غير مسجَّلة — وليس صفراً", () => {
    expect(parseDeliveryCostInput("")).toEqual({ ok: true, value: null });
    expect(parseDeliveryCostInput("   ")).toEqual({ ok: true, value: null });
  });

  test("الصفر الصريح يُقبَل: توصيل لم يكلّفنا شيئاً فعلاً (استلام من المحل)", () => {
    expect(parseDeliveryCostInput("0")).toEqual({ ok: true, value: 0 });
  });

  test("السالب وغير الرقم والكبير جداً كلها مرفوضة برسالة عربية", () => {
    for (const bad of ["-5", "abc", String(MAX_DELIVERY_COST_MAD + 1)]) {
      const result = parseDeliveryCostInput(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
