import { describe, expect, test } from "vitest";
import {
  addDays,
  localDayString,
  parsePreset,
  resolveRange,
  startOfLocalDay,
} from "@/lib/analytics/dateRange";

const TZ = "Africa/Casablanca";

describe("التوقيت المحلي — المغرب لا UTC", () => {
  test("طلب الساعة 23:30 محلياً ينتمي لنفس اليوم لا لليوم التالي", () => {
    // 2026-08-20 23:30 بتوقيت المغرب (UTC+1) = 22:30 UTC.
    const at = new Date("2026-08-20T22:30:00Z");
    expect(localDayString(at, TZ)).toBe("2026-08-20");
    // لو حسبناه بـUTC لكان اليوم نفسه هنا، فنختبر الحالة الحاسمة:
    // 00:30 محلياً = 23:30 UTC من اليوم السابق.
    expect(localDayString(new Date("2026-08-20T23:30:00Z"), TZ)).toBe("2026-08-21");
  });

  test("بداية اليوم المحلي تُترجَم إلى اللحظة المطلقة الصحيحة", () => {
    // منتصف ليل 21/08 بالمغرب (UTC+1) = 23:00 UTC من 20/08.
    expect(startOfLocalDay("2026-08-21", TZ).toISOString()).toBe("2026-08-20T23:00:00.000Z");
  });

  test("addDays يعبر حدود الشهر بأمان", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });
});

describe("resolveRange — اختيارات الفترة", () => {
  const now = new Date("2026-08-21T10:00:00Z"); // 11:00 بتوقيت المغرب

  test("اليوم: يوم واحد، والحدّ الأعلى منتصف ليل الغد (غير شامل)", () => {
    const range = resolveRange("today", undefined, undefined, now, TZ);
    expect(range.fromDay).toBe("2026-08-21");
    expect(range.toDay).toBe("2026-08-21");
    expect(range.from.toISOString()).toBe("2026-08-20T23:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-08-21T23:00:00.000Z");
  });

  test("أمس", () => {
    const range = resolveRange("yesterday", undefined, undefined, now, TZ);
    expect(range.fromDay).toBe("2026-08-20");
    expect(range.toDay).toBe("2026-08-20");
  });

  test("آخر 7 أيام تشمل اليوم الحالي (7 أيام لا 8)", () => {
    const range = resolveRange("7d", undefined, undefined, now, TZ);
    expect(range.fromDay).toBe("2026-08-15");
    expect(range.toDay).toBe("2026-08-21");
  });

  test("آخر 30 يوم", () => {
    const range = resolveRange("30d", undefined, undefined, now, TZ);
    expect(range.fromDay).toBe("2026-07-23");
    expect(range.toDay).toBe("2026-08-21");
  });

  test("مدة مخصّصة صالحة", () => {
    const range = resolveRange("custom", "2026-08-18", "2026-08-20", now, TZ);
    expect(range.preset).toBe("custom");
    expect(range.fromDay).toBe("2026-08-18");
    expect(range.toDay).toBe("2026-08-20");
  });

  test("تاريخان مقلوبان يُصلَحان بدل رفضهما", () => {
    const range = resolveRange("custom", "2026-08-20", "2026-08-18", now, TZ);
    expect(range.fromDay).toBe("2026-08-18");
    expect(range.toDay).toBe("2026-08-20");
  });

  test("مدة مخصّصة تالفة ترجع للافتراضي بدل صفحة خطأ", () => {
    const range = resolveRange("custom", "not-a-date", "2026-08-20", now, TZ);
    expect(range.preset).toBe("7d");
    expect(range.fromDay).toBe("2026-08-15");
  });

  test("قيمة فترة مخترَعة تُعامَل كالافتراضي", () => {
    expect(parsePreset("../../etc/passwd")).toBe("7d");
    expect(resolveRange("drop table", undefined, undefined, now, TZ).preset).toBe("7d");
  });
});
