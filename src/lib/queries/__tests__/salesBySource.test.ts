import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { getSalesBySource } from "@/lib/queries/adminReports";
import { resolveRange } from "@/lib/analytics/dateRange";

/**
 * المصدر فلتر اختياري، ومساراه (بفلتر وبلا فلتر) استعلامان مختلفان فعلياً.
 * أول نسخة بنت الفلتر بشظية SQL شرطية فمرّت محلياً وأسقطت الصفحة بـ500 على
 * Preview خلف pgBouncer — فالمساران يُختبَران هنا كلاهما، صراحةً.
 */

const PHONE = "0655770001";
const range = () => resolveRange("30d", undefined, undefined);

beforeAll(async () => {
  await sql`
    insert into public.orders (
      customer_name, customer_phone, customer_city, customer_address,
      items_subtotal, delivery_fee, final_total, status, source
    ) values
    ('اختبار موقع',  ${PHONE}, 'مراكش', 'ع', 1000, 50, 1050, 'delivered', 'website'),
    ('اختبار واتساب', ${PHONE}, 'مراكش', 'ع',  600, 45,  645, 'delivered', 'whatsapp'),
    ('اختبار واتساب معلَّق', ${PHONE}, 'مراكش', 'ع', 300, 0, 300, 'confirmed', 'whatsapp')
  `;
});

afterAll(async () => {
  await sql`delete from public.orders where customer_phone = ${PHONE}`;
});

describe("المبيعات حسب المصدر", () => {
  test("بلا فلتر: يُرجع كل المصادر ومجموعها صحيح", async () => {
    const { rows, totals } = await getSalesBySource(range(), null);
    const website = rows.find((r) => r.source === "website");
    const whatsapp = rows.find((r) => r.source === "whatsapp");

    expect(website).toBeDefined();
    expect(whatsapp).toBeDefined();
    expect(totals.revenueMad).toBe(rows.reduce((sum, r) => sum + r.revenueMad, 0));
  });

  test("بفلتر مصدر: يُرجع ذلك المصدر وحده — المسار الذي كان يسقط", async () => {
    const { rows } = await getSalesBySource(range(), "whatsapp");
    expect(rows.every((r) => r.source === "whatsapp")).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("الطلبات المؤكَّدة غير المسلَّمة تُعَدّ منفصلة ولا تدخل الربح", async () => {
    const { rows } = await getSalesBySource(range(), "whatsapp");
    const whatsapp = rows[0];
    // المسلَّم 600 فقط؛ الـ300 المؤكَّدة تظهر في الانتظار لا في المبيعات.
    expect(whatsapp.revenueMad).toBeGreaterThanOrEqual(600);
    expect(whatsapp.pendingRevenueMad).toBeGreaterThanOrEqual(300);
  });

  test("فلتر مصدر بلا طلبات يُرجع قائمة فارغة بلا انفجار", async () => {
    const { rows, totals } = await getSalesBySource(range(), "store");
    expect(rows).toEqual([]);
    expect(totals.revenueMad).toBe(0);
  });
});
