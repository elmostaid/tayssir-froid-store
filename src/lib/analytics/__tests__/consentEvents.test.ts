import { afterAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { isAnalyticsEventName } from "@/lib/analytics/events";

/**
 * نسبة الموافقة تُقاس في القياس الداخلي: الاسمان مقبولان في القائمة
 * المغلقة **وفي** قيد القاعدة معاً — وإلا سقطت الأحداث بصمت عند الإدخال.
 */
const session = randomUUID();

afterAll(async () => {
  await sql`delete from public.analytics_events where session_id = ${session}`;
});

describe("أحداث اختيار الموافقة", () => {
  test.each(["ad_consent_granted", "ad_consent_denied"])("%s: في القائمة وفي قيد القاعدة", async (name) => {
    expect(isAnalyticsEventName(name)).toBe(true);
    await sql`
      insert into public.analytics_events (session_id, event_name, page_path, has_click_id)
      values (${session}, ${name}, '/', false)
    `;
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.analytics_events where session_id = ${session} and event_name = ${name}
    `;
    expect(row.n).toBe(1);
  });

  test("اسم مخترع: مرفوض في الطرفين", async () => {
    expect(isAnalyticsEventName("ad_consent_maybe")).toBe(false);
    await expect(sql`
      insert into public.analytics_events (session_id, event_name, page_path, has_click_id)
      values (${session}, 'ad_consent_maybe', '/', false)
    `).rejects.toThrow();
  });
});
