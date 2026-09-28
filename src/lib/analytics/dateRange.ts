import { REPORT_TIME_ZONE } from "@/lib/queries/adminAnalytics";

/**
 * حساب المدى الزمني للوحة بتوقيت المغرب.
 *
 * الخادم يعمل بتوقيت UTC، والمغرب على UTC+1 عدا شهر رمضان حيث يعود إلى
 * UTC+0. لذلك لا نجمع ساعة ثابتة يدوياً — نسأل Intl عن الإزاحة الفعلية
 * لكل تاريخ على حدة، فيبقى الحساب صحيحاً في رمضان وخارجه بلا أي صيانة.
 */

export const RANGE_PRESETS = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "month",
  "all_time",
  "custom",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: "اليوم",
  yesterday: "أمس",
  "7d": "آخر 7 أيام",
  "30d": "آخر 30 يوم",
  month: "الشهر الحالي",
  all_time: "منذ البداية",
  custom: "مدة مخصّصة",
};

/**
 * الاختيارات المعروضة كأزرار في كل صفحة — لكل صفحة قائمتها، لا فلترة مكرّرة
 * في الواجهة.
 *
 * `custom` مستثنى من الاثنتين لأن له نموذجه الخاص (حقلا تاريخ) لا زرّاً.
 * و`all_time` معروض في التقارير وحدها عمداً: أرقام التقارير مجموعات SQL على
 * جدول الطلبات (خمسة صفوف على الأكثر، واحد لكل مصدر)، فتوسيع المدى لا يزيد
 * شيئاً في حجم ما يُنقل ولا في عدد الصفوف. أما صفحة التحليلات فتقرأ
 * analytics_events — صفٌّ لكل حدث زائر — ومدى مفتوح هناك مسحٌ كامل للجدول
 * بلا فائدة للمدير. من أراد مدى أطول في التحليلات فله «مدة مخصّصة».
 */
export const REPORT_RANGE_PRESETS = RANGE_PRESETS.filter(
  (preset) => preset !== "custom"
);
export const ANALYTICS_RANGE_PRESETS = RANGE_PRESETS.filter(
  (preset) => preset !== "custom" && preset !== "all_time"
);

/**
 * بداية «منذ البداية».
 *
 * ليس تاريخ أقدم طلب — وهذا مقصود. قراءة أقدم طلب تعني استعلاماً إضافياً
 * يجب أن ينجح قبل أن تُحسب أي أرقام، وفشله كان سيُنتج مدى يوماً واحداً
 * يبدو صحيحاً وهو خاطئ. أما تاريخ ثابت يسبق أول طلب بسنوات فيجعل شرط
 * `created_at >= from` لا يستثني شيئاً أصلاً، فالمجموع هو مجموع كل ما في
 * الجدول بلا اعتماد على أي قراءة ثانية.
 *
 * المتجر أُنشئ في 2026، والقيمة هنا تسبقه بعشرين سنة — ولو أُدخل طلب
 * تاريخه قبلها (استيراد قديم مثلاً) لظهر خارج المدى؛ لذلك تُقرأ بداية
 * الطلبات الفعلية وتُعرض للمدير (getEarliestOrderDay)، فيرى بعينه أن المدى
 * يغطّي أول يوم سُجّل فيه طلب.
 */
export const ALL_TIME_START_DAY = "2006-01-01";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** إزاحة المنطقة الزمنية بالدقائق في لحظة بعينها. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return (asUtc - at.getTime()) / 60000;
}

/** "YYYY-MM-DD" لليوم المحلي الذي تقع فيه اللحظة المعطاة. */
export function localDayString(at: Date, timeZone = REPORT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return parts;
}

/** منتصف ليل اليوم المحلي المعطى، كلحظة مطلقة (UTC). */
export function startOfLocalDay(ymd: string, timeZone = REPORT_TIME_ZONE): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const offset = offsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

export function addDays(ymd: string, days: number): string {
  const base = new Date(`${ymd}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function isValidDayString(value: unknown): value is string {
  return typeof value === "string" && YMD_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function parsePreset(value: unknown): RangePreset {
  return typeof value === "string" && (RANGE_PRESETS as readonly string[]).includes(value)
    ? (value as RangePreset)
    : "7d";
}

export type ResolvedRange = {
  preset: RangePreset;
  /** أول يوم محلي داخل المدى (شامل). */
  fromDay: string;
  /** آخر يوم محلي داخل المدى (شامل). */
  toDay: string;
  /** الحدّان المطلقان للاستعلام: from شامل، to غير شامل. */
  from: Date;
  to: Date;
};

/**
 * يحوّل اختيار المستخدم إلى مدى قابل للاستعلام. الحدّ الأعلى غير شامل دائماً
 * (منتصف ليل اليوم التالي) — وهي الطريقة الوحيدة لضم أحداث اليوم الأخير كلها
 * بلا اعتماد على دقّة الثواني.
 */
export function resolveRange(
  presetRaw: unknown,
  fromRaw: unknown,
  toRaw: unknown,
  now = new Date(),
  timeZone = REPORT_TIME_ZONE
): ResolvedRange {
  const today = localDayString(now, timeZone);
  let preset = parsePreset(presetRaw);
  let fromDay: string;
  let toDay: string;

  if (preset === "custom") {
    if (!isValidDayString(fromRaw) || !isValidDayString(toRaw)) {
      // مدى مخصّص ناقص أو تالف: نرجع للافتراضي بدل عرض صفحة خطأ.
      preset = "7d";
      fromDay = addDays(today, -6);
      toDay = today;
    } else {
      // تاريخان مقلوبان (اختار النهاية قبل البداية) — نُصلحهما بدل رفضهما.
      fromDay = fromRaw <= toRaw ? fromRaw : toRaw;
      toDay = fromRaw <= toRaw ? toRaw : fromRaw;
    }
  } else if (preset === "today") {
    fromDay = today;
    toDay = today;
  } else if (preset === "yesterday") {
    fromDay = addDays(today, -1);
    toDay = fromDay;
  } else if (preset === "30d") {
    fromDay = addDays(today, -29);
    toDay = today;
  } else if (preset === "all_time") {
    // لا حدّ أدنى: البداية تسبق أول طلب بسنوات، فالشرط لا يستثني شيئاً.
    fromDay = ALL_TIME_START_DAY;
    toDay = today;
  } else if (preset === "month") {
    // من أول الشهر المحلي إلى اليوم. نشتقّه من نصّ اليوم نفسه لا من كائن
    // Date جديد: `today` محسوب أصلاً بتوقيت المغرب، فاشتقاق الشهر منه يبقى
    // صحيحاً ولو كان الخادم في منطقة أخرى.
    fromDay = `${today.slice(0, 7)}-01`;
    toDay = today;
  } else {
    fromDay = addDays(today, -6);
    toDay = today;
  }

  return {
    preset,
    fromDay,
    toDay,
    from: startOfLocalDay(fromDay, timeZone),
    to: startOfLocalDay(addDays(toDay, 1), timeZone),
  };
}
