import { afterAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { ANALYTICS_EVENT_NAMES } from "@/lib/analytics/events";

/**
 * قائمة أسماء الأحداث مكتوبة في ثلاثة مواضع يجب أن تتطابق: الثابت في
 * `lib/analytics/events.ts`، والتحقّق في `/api/analytics` (يقرأ من نفس
 * الثابت)، وقيد CHECK في القاعدة (مكتوب في هجرة مستقلة).
 *
 * الثالث هو الوحيد الذي يمكن أن ينحرف بصمت: إضافة اسم إلى الثابت بلا هجرة
 * تُنتج كوداً يبدو سليماً ويمرّ كل الاختبارات، بينما كل حدث من النوع الجديد
 * يسقط في الإنتاج داخل catch صامت في نقطة الاستقبال — أي قياس مفقود بلا أي
 * إشارة. هذا الاختبار يُغلق تلك الفجوة بأن يكتب كل اسم فعلياً في القاعدة.
 */
const SESSION = randomUUID();

afterAll(async () => {
  await sql`delete from public.analytics_events where session_id = ${SESSION}`;
});

describe("قيد أسماء الأحداث في القاعدة يطابق الكود", () => {
  test("كل اسم في ANALYTICS_EVENT_NAMES تقبله القاعدة", async () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      await sql`
        insert into public.analytics_events (session_id, event_name)
        values (${SESSION}, ${name})
      `;
    }

    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from public.analytics_events
      where session_id = ${SESSION}
    `;
    expect(Number(count)).toBe(ANALYTICS_EVENT_NAMES.length);
  });

  test("اسم مخترع ترفضه القاعدة ولو مرّ من الكود", async () => {
    await expect(
      sql`
        insert into public.analytics_events (session_id, event_name)
        values (${SESSION}, ${"whatsapp_from_nowhere"})
      `
    ).rejects.toThrow();
  });
});
