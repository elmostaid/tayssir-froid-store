import { describe, expect, test } from "vitest";
import {
  addDays,
  ALL_TIME_START_DAY,
  ANALYTICS_RANGE_PRESETS,
  localDayString,
  parsePreset,
  REPORT_RANGE_PRESETS,
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

describe("«منذ البداية» — مدى بلا حدّ أعلى للمدة", () => {
  const now = new Date("2026-09-28T22:20:00Z"); // 23:20 بتوقيت المغرب

  test("يبدأ قبل أي طلب ممكن وينتهي باليوم الحالي", () => {
    const range = resolveRange("all_time", undefined, undefined, now, TZ);
    expect(range.preset).toBe("all_time");
    expect(range.fromDay).toBe(ALL_TIME_START_DAY);
    expect(range.toDay).toBe("2026-09-28");
  });

  test("الحدّ الأعلى غير شامل: منتصف ليل الغد المحلي", () => {
    const range = resolveRange("all_time", undefined, undefined, now, TZ);
    // منتصف ليل 29/09 بتوقيت المغرب. المغرب رجع لـUTC+0 فـ20 شتنبر 2026
    // (tzdata 2026e)، فالقيمة بـUTC كتختلف حسب نسخة tzdata ديال البيئة:
    // 23:00 من 28/09 (نسخة قديمة، UTC+1) أو 00:00 من 29/09 (نسخة حديثة).
    // المهم هو المعنى: منتصف الليل المحلي بالضبط، ديال نهار 29.
    expect(["2026-09-28T23:00:00.000Z", "2026-09-29T00:00:00.000Z"]).toContain(range.to.toISOString());
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(range.to);
    expect(local).toBe("29/09/2026, 00:00");
  });

  test("يغطّي طلباً أقدم بسنوات من أي اختيار آخر", () => {
    const range = resolveRange("all_time", undefined, undefined, now, TZ);
    const oldOrder = new Date("2026-03-01T09:00:00Z");
    expect(range.from.getTime()).toBeLessThan(oldOrder.getTime());
    expect(range.to.getTime()).toBeGreaterThan(oldOrder.getTime());
    // وأوسع فعلاً من «آخر 30 يوم»، وهو ما كان أقصى المتاح قبل هذا الاختيار.
    const thirty = resolveRange("30d", undefined, undefined, now, TZ);
    expect(range.from.getTime()).toBeLessThan(thirty.from.getTime());
    expect(thirty.from.getTime()).toBeGreaterThan(oldOrder.getTime());
  });

  test("اسم الاختيار مقبول من الرابط ولا يرتدّ إلى الافتراضي", () => {
    expect(parsePreset("all_time")).toBe("all_time");
  });

  test("معروض في التقارير، محجوب عن التحليلات، وcustom خارج الأزرار", () => {
    expect(REPORT_RANGE_PRESETS).toContain("all_time");
    expect(ANALYTICS_RANGE_PRESETS).not.toContain("all_time");
    expect(REPORT_RANGE_PRESETS).not.toContain("custom");
    expect(ANALYTICS_RANGE_PRESETS).not.toContain("custom");
    // بقية الاختيارات باقية كما هي في الصفحتين.
    for (const preset of ["today", "yesterday", "7d", "30d", "month"] as const) {
      expect(REPORT_RANGE_PRESETS).toContain(preset);
      expect(ANALYTICS_RANGE_PRESETS).toContain(preset);
    }
  });

  test("الاختيارات الأخرى لم تتغيّر بإضافته", () => {
    expect(resolveRange("30d", undefined, undefined, now, TZ).fromDay).toBe("2026-08-30");
    expect(resolveRange("month", undefined, undefined, now, TZ).fromDay).toBe("2026-09-01");
    expect(resolveRange("today", undefined, undefined, now, TZ).fromDay).toBe("2026-09-28");
    expect(resolveRange("yesterday", undefined, undefined, now, TZ).fromDay).toBe("2026-09-27");
    expect(resolveRange("7d", undefined, undefined, now, TZ).fromDay).toBe("2026-09-22");
  });
});
