import { afterAll, beforeAll, describe, expect, test } from "vitest";

// اختبار تكامل حقيقي على PostgreSQL محلية: الهدف منه أن كل استعلام في
// sessionModeProbe.ts يُنفَّذ فعلاً على قاعدة حيّة ويُرجع الشكل المتوقَّع —
// محاكاة القاعدة هنا كانت ستُخفي بالضبط ما نريد إثباته (صياغة SQL، سلوك
// المهلة، إرجاع المعاملة).
//
// ⚠️ هذا ليس إثباتاً لسلوك Supavisor. الاتصال المحلي مباشر، ونمط المجمّع لا
// يُحاكى هنا إطلاقاً — القياس الحقيقي يبقى على المعاينة عبر مسار التشخيص.
// ما يُثبته هذا الملف: أن الأداة نفسها صحيحة قبل أن نحمل أرقامها.
//
// نضبط المهلة على 1500ms بدل 8000 حتى ينتهي الملف في ثوانٍ لا في نصف دقيقة
// (الاستعلام الطويل 12 ثانية، فالمهلة هي ما يوقفه) — وهذا بنفسه اختبار
// لمسار DB_STATEMENT_TIMEOUT_MS.
process.env.DB_STATEMENT_TIMEOUT_MS = "1500";
process.env.DB_POOL_MAX = "2";

const { sql } = await import("@/lib/db");
const { runSessionModeProbe } = await import("@/lib/diagnostics/sessionModeProbe");

let report: Awaited<ReturnType<typeof runSessionModeProbe>>;

beforeAll(async () => {
  await sql`
    create table if not exists public.diag_probe (
      id bigserial primary key,
      note text not null,
      at timestamptz not null default clock_timestamp()
    )
  `;
  report = await runSessionModeProbe();
}, 90000);

afterAll(async () => {
  await sql`drop table if exists public.diag_probe`;
  delete process.env.DB_STATEMENT_TIMEOUT_MS;
  delete process.env.DB_POOL_MAX;
});

describe("الإعداد الفعلي كما يراه الخادم", () => {
  test("المهلة المُرسَلة كمعامل بدء تظهر في current_setting", () => {
    expect(report.runtimeConfig!.statementTimeoutOptionMs).toBe(1500);
    expect(report.runtimeConfig!.poolMax).toBe(2);
    // الاتصال المباشر يقبل المعامل، فالخادم يُقرّ به بنفسه.
    expect(report.serverSettings?.statement_timeout).toBe("1500ms");
  });

  test("يقرأ بقية المهل والمستخدم ومعرّف العملية بلا أي سرّ", () => {
    expect(report.serverSettings?.db_user).toBeTruthy();
    expect(Number(report.serverSettings?.server_version_num)).toBeGreaterThan(140000);
    expect(report.serverSettings?.backend_pid).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("postgres://");
  });
});

describe("كشف حالة الجلسة", () => {
  test("على اتصال مباشر تبقى قيمة SET بين استعلامين — وهو سلوك نمط الجلسة", () => {
    expect(report.sessionState?.observed).toBe("3777ms");
    expect(report.sessionState?.persisted).toBe(true);
    expect(report.sessionState?.restoredTo).toBe("1500ms");
  });
});

describe("استعلام يتجاوز المهلة", () => {
  test("الخادم هو من يوقفه، بـ57014، لا العميل", () => {
    expect(report.longQuery.error?.code).toBe("57014");
    expect(report.longQuery.error?.fromServer).toBe(true);
    expect(report.longQuery.stoppedByServer).toBe(true);
    expect(report.longQuery.guardFired).toBe(false);
  });

  test("ينتهي قرب المهلة لا قرب مدة النوم المطلوبة", () => {
    expect(report.longQuery.elapsedMs).toBeLessThan(6000);
    expect(report.longQuery.requestedSleepSeconds).toBe(12);
  });

  test("ولا يترك الاتصال معلَّقاً — استعلام تافه بعده ينجح", () => {
    expect(report.longQuery.connectionUsableAfter).toBe(true);
  });
});

describe("معاملة sql.begin() عند تجاوز المهلة", () => {
  test("تُرجَع كاملةً: لا صفّ واحد يبقى مكتوباً", () => {
    expect(report.transaction.skipped).toBe(false);
    expect(report.transaction.error?.code).toBe("57014");
    expect(report.transaction.rowsAfter).toBe(0);
    expect(report.transaction.rolledBack).toBe(true);
  });
});

describe("الاتصالات والانتظار", () => {
  test("يقرأ حدود الخادم وعدّادات طابور العميل", () => {
    expect(Number(report.pool.serverLimits?.max_connections)).toBeGreaterThan(0);
    expect(report.pool.clientQueueCounters!.armed).toBeGreaterThan(0);
    expect(report.pool.clientQueueCounters!.peakInFlight).toBeGreaterThan(0);
    // الاتصال المحلي مباشر فلا اتصالات باسم Supavisor — صفر هنا صحيح.
    expect(report.pool.supavisorBackends?.total).toBe(0);
  });

  test("كل استعلام سُلِّح انتهى فعلاً — لا اتصال محجوز إلى الأبد", () => {
    expect(report.pool.clientQueueCounters!.inFlight).toBe(0);
  });
});

describe("إعادة استعمال الاتصال", () => {
  test("يُبلِّغ بمعرّف عملية الخادم ولحظة بدايتها", () => {
    expect(report.connectionReuse.backendPidAtStart).toBeGreaterThan(0);
    expect(report.connectionReuse.backendPidAtEnd).toBeGreaterThan(0);
    expect(report.connectionReuse.secondsSinceBackendStart).toBeGreaterThanOrEqual(0);
  });
});
