import { describe, expect, test } from "vitest";
import { inBatches, MAX_CONCURRENT_QUERIES } from "@/lib/queryBatches";

/**
 * ما يُثبته هذا الملف: أن `inBatches` **تحدّ التزامن فعلاً** وتُعيد نفس
 * ما كانت تُعيده `Promise.all` بنفس الترتيب — وهما الشرطان اللذان يجعل
 * استبدالها في صفحات المتجر آمناً.
 *
 * وما لا يُثبته: أي شيء عن عدد اتصالات Postgres الحقيقية. ذاك قيس بوسيط
 * TCP يَعُدّ الاتصالات على قاعدة محلية (5 من 5 قبل، 3 من 5 بعد)، وهو قياس
 * لا يُحاكى في اختبار وحدة.
 */

/** يسجّل أقصى عدد مهام كانت جارية في اللحظة نفسها. */
function tracker() {
  let live = 0;
  let peak = 0;
  const order: number[] = [];
  const task = (id: number, ms = 5) => async () => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, ms));
    order.push(id);
    live -= 1;
    return id * 10;
  };
  return { task, peak: () => peak, order };
}

describe("inBatches — حدّ التزامن", () => {
  test("لا تتجاوز حجم الدفعة أبداً، مهما كان عدد المهام", async () => {
    const t = tracker();
    const tasks = Array.from({ length: 11 }, (_, i) => t.task(i));
    await inBatches(tasks, 3);
    expect(t.peak()).toBe(3);
  });

  test("الحدّ الافتراضي ثلاثة — ثلاثة من أصل خمسة في المجمّع", async () => {
    expect(MAX_CONCURRENT_QUERIES).toBe(3);
    const t = tracker();
    await inBatches(Array.from({ length: 8 }, (_, i) => t.task(i)));
    expect(t.peak()).toBe(3);
  });

  test("Promise.all بالمقارنة تُطلق الثمانية كلها — وهو ما كان يحتكر المجمّع", async () => {
    const t = tracker();
    await Promise.all(Array.from({ length: 8 }, (_, i) => t.task(i)()));
    expect(t.peak()).toBe(8);
  });

  test("ترتيب النتائج هو ترتيب المهام، لا ترتيب انتهائها", async () => {
    const t = tracker();
    // الأولى أبطأ من الثانية: لو كان الترتيب ترتيبَ الانتهاء لانقلبا.
    const results = await inBatches([t.task(1, 40), t.task(2, 1), t.task(3, 1)] as const, 3);
    expect(results).toEqual([10, 20, 30]);
    expect(t.order).toEqual([2, 3, 1]);
  });

  test("مهمة واحدة ومصفوفة فارغة لا تُنتجان حالة شاذة", async () => {
    expect(await inBatches([] as const, 3)).toEqual([]);
    expect(await inBatches([async () => "واحدة"] as const, 3)).toEqual(["واحدة"]);
  });

  test("فشل مهمة يُرمى كما ترميه Promise.all — لا يُكتَم", async () => {
    await expect(
      inBatches([async () => 1, async () => { throw new Error("فشل مقصود"); }] as const, 3)
    ).rejects.toThrow("فشل مقصود");
  });

  test("الدفعة الأولى تنتهي قبل أن تبدأ الثانية", async () => {
    const t = tracker();
    const tasks = Array.from({ length: 6 }, (_, i) => t.task(i, 5));
    await inBatches(tasks, 3);
    // أول ثلاثة انتهوا كلهم قبل أي من الثلاثة الأخيرين.
    const firstBatch = t.order.slice(0, 3).sort();
    expect(firstBatch).toEqual([0, 1, 2]);
  });
});
