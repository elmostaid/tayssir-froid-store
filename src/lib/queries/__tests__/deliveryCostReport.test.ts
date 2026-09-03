import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { getSalesBySource } from "@/lib/queries/adminReports";
import { resolveRange } from "@/lib/analytics/dateRange";

/**
 * أثر التوصيل في التقرير — على قاعدة بيانات حقيقية.
 *
 * الاختبار الوحيد الذي لا يمكن أن تلتقطه دالة نقية: أن `SUM` في Postgres
 * لا يبتلع طلباً بلا تكلفة كأنه صفر. الأربعة الأولى تتحقّق من الحساب،
 * والخامس والسادس من الصدق: طلب `actual_delivery_cost = NULL` يجب أن
 * يُعَدّ في `ordersMissingDeliveryCost` ويغيب تماماً عن كل مجموع، وأن
 * يغيب معه **إيراد توصيله** عن طرف الطرح الآخر — وإلا ظهر فائض وهمي.
 *
 * المصدر هنا `store` عمداً: مصدر لا تستعمله بقية الاختبارات، فلا تختلط
 * أرقامه بأرقامها.
 */

const PHONE = "0655880002";
const range = () => resolveRange("30d", undefined, undefined);

// أربع الحالات التي طلبها صاحب المتجر، ثم حالتا NULL.
beforeAll(async () => {
  await sql`
    insert into public.orders (
      customer_name, customer_phone, customer_city, customer_address,
      items_subtotal, delivery_fee, actual_delivery_cost, final_total, status, source
    ) values
    -- 1) دفع 30، كلّفنا 45  → −15
    ('تكلفة أعلى',   ${PHONE}, 'مراكش', 'ع', 1000, 30, 45,   1030, 'delivered', 'store'),
    -- 2) دفع 0،  كلّفنا 45  → −45
    ('توصيل مجاني',  ${PHONE}, 'مراكش', 'ع', 1000,  0, 45,   1000, 'delivered', 'store'),
    -- 3) دفع 45، كلّفنا 45  →   0
    ('تمريرة',       ${PHONE}, 'مراكش', 'ع', 1000, 45, 45,   1045, 'delivered', 'store'),
    -- 4) دفع 45، كلّفنا 35  → +10
    ('فائض',         ${PHONE}, 'مراكش', 'ع', 1000, 45, 35,   1045, 'delivered', 'store'),
    -- 5) مسلَّم بلا تكلفة مسجَّلة: يُعَدّ ولا يدخل أي مجموع
    ('غير مسجَّلة',   ${PHONE}, 'مراكش', 'ع', 1000, 60, null, 1060, 'delivered', 'store'),
    -- 6) غير مسلَّم: خارج كل حسابات التوصيل أصلاً
    ('لم يُسلَّم',     ${PHONE}, 'مراكش', 'ع',  500, 30, null,  530, 'confirmed', 'store')
  `;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone = ${PHONE}`;
});

describe("أثر التوصيل في تقرير المبيعات", () => {
  test("صافي أثر التوصيل يجمع الحالات الأربع بشكل صحيح", async () => {
    const { rows } = await getSalesBySource(range(), "store");
    const row = rows[0];

    // −15 + −45 + 0 + +10 = −50
    expect(row.deliveryNetMad).toBe(-50);
    // 45 + 45 + 45 + 35 = 170
    expect(row.deliveryCostRecordedMad).toBe(170);
    // 30 + 0 + 45 + 45 = 120 (بلا الستين من الطلب غير المسجَّل)
    expect(row.deliveryFeesOnCostedMad).toBe(120);
    expect(row.deliveryNetMad).toBe(
      row.deliveryFeesOnCostedMad - row.deliveryCostRecordedMad
    );
  });

  test("الطلب بلا تكلفة يُعَدّ ولا يُحتسَب صفراً", async () => {
    const { rows } = await getSalesBySource(range(), "store");
    const row = rows[0];

    expect(row.ordersMissingDeliveryCost).toBe(1);
    expect(row.deliveryFeesMissingCostMad).toBe(60);

    // لو عُدّ صفراً لصار الصافي −50 + 60 = +10 بدل −50.
    expect(row.deliveryNetMad).not.toBe(10);
  });

  test("إيراد الطلب غير المسجَّل يبقى في المحصَّل الكلي ولا يدخل الصافي", async () => {
    const { rows } = await getSalesBySource(range(), "store");
    const row = rows[0];

    // المحصَّل الكلي يشمل الستين (رقم واقعي عن المال الداخل)…
    expect(row.deliveryFeesMad).toBe(180);
    // …بينما طرفا الطرح لا يشملانها (رقم صادق عن الربح).
    expect(row.deliveryFeesMad - row.deliveryFeesOnCostedMad).toBe(
      row.deliveryFeesMissingCostMad
    );
  });

  test("الطلبات غير المسلَّمة خارج حساب التوصيل بالكامل", async () => {
    const { rows } = await getSalesBySource(range(), "store");
    const row = rows[0];

    expect(row.deliveredOrders).toBe(5);
    expect(row.pendingOrders).toBe(1);
    // الثلاثون درهماً من الطلب المؤكَّد لا تظهر في أي رقم توصيل.
    expect(row.deliveryFeesMad).toBe(180);
  });

  test("المجاميع الكلية تساوي مجموع الصفوف", async () => {
    const { rows, totals } = await getSalesBySource(range(), null);
    const sum = (pick: (r: (typeof rows)[number]) => number) =>
      rows.reduce((acc, r) => acc + pick(r), 0);

    expect(totals.deliveryNetMad).toBeCloseTo(sum((r) => r.deliveryNetMad), 2);
    expect(totals.deliveryCostRecordedMad).toBeCloseTo(
      sum((r) => r.deliveryCostRecordedMad),
      2
    );
    expect(totals.ordersMissingDeliveryCost).toBe(sum((r) => r.ordersMissingDeliveryCost));
  });

  test("معادلة الربح النهائي: خام + صافي التوصيل − مصاريف", async () => {
    const { rows } = await getSalesBySource(range(), "store");
    const row = rows[0];
    const operatingExpenses = 100;

    const net = row.grossProfitMad + row.deliveryNetMad - operatingExpenses;
    expect(net).toBe(row.grossProfitMad - 50 - 100);
  });
});
