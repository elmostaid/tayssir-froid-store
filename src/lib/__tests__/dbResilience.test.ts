import type postgres from "postgres";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ConnectionGuard,
  classifyStatement,
  DB_RESILIENCE_DEFAULTS,
  readDbResilienceConfig,
  type DbResilienceConfig,
} from "@/lib/dbResilience";

// عميل مُلفَّق: يكفي أن يكون قابلاً للنداء كدالة وسم (tag) وأن يملك end،
// فهذا كل ما يستعمله الحارس من postgres.js. هكذا نختبر منطق القرار كاملاً
// بلا قاعدة بيانات ولا انتظار حقيقي — وسيناريوهات الانقطاع الحقيقية لها
// نصّها المنفصل (scripts/db-resilience-scenarios.mts) على قاعدة حيّة.
type Behaviour = "ok" | "hang" | "error";

function fakeClient(behaviour: Behaviour) {
  const calls = { queries: 0, ended: 0, endOptions: [] as unknown[] };
  const client = (() => {
    calls.queries += 1;
    if (behaviour === "ok") return Promise.resolve([{ ok: 1 }]);
    if (behaviour === "error") {
      return Promise.reject(
        Object.assign(new Error("socket is gone"), { code: "CONNECTION_CLOSED" })
      );
    }
    return new Promise(() => {
      /* معلَّق إلى الأبد — مقبس ميت */
    });
  }) as unknown as ReturnType<typeof postgres>;
  (client as unknown as { end: (o?: unknown) => Promise<void> }).end = async (o?: unknown) => {
    calls.ended += 1;
    calls.endOptions.push(o);
  };
  return { client, calls };
}

function harness(options: {
  behaviours: Behaviour[];
  config?: Partial<DbResilienceConfig>;
}) {
  let index = 0;
  const made: ReturnType<typeof fakeClient>[] = [];
  let now = 1_000_000;
  const guard = new ConnectionGuard({
    create: () => {
      const made_ = fakeClient(options.behaviours[Math.min(index, options.behaviours.length - 1)]);
      index += 1;
      made.push(made_);
      return made_.client;
    },
    now: () => now,
    config: () => ({ ...DB_RESILIENCE_DEFAULTS, ...options.config }),
  });
  return {
    guard,
    made,
    advanceClock: (ms: number) => {
      now += ms;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("readDbResilienceConfig — الافتراضي هو سلوك الإنتاج، والإطفاء صريح", () => {
  test("بلا أي متغيّر: الفحص والإتلاف مُفعَّلان بالقيم الموثَّقة", () => {
    expect(readDbResilienceConfig({})).toEqual(DB_RESILIENCE_DEFAULTS);
  });

  test("off يُطفئ — وهذه هي خطة الرجوع بلا نشر", () => {
    const config = readDbResilienceConfig({
      DB_LIVENESS_PREFLIGHT: "off",
      DB_HANG_ESCALATION: "off",
    });
    expect(config.preflight).toBe(false);
    expect(config.escalation).toBe(false);
  });

  test("قيمة مشوَّهة أو خارج النطاق تعود إلى الافتراضي، لا إلى صفر", () => {
    expect(readDbResilienceConfig({ DB_PREFLIGHT_TIMEOUT_MS: "0" }).preflightTimeoutMs).toBe(
      DB_RESILIENCE_DEFAULTS.preflightTimeoutMs
    );
    expect(readDbResilienceConfig({ DB_STALE_AFTER_MS: "نعم" }).staleAfterMs).toBe(
      DB_RESILIENCE_DEFAULTS.staleAfterMs
    );
    expect(readDbResilienceConfig({ DB_PREFLIGHT_TIMEOUT_MS: "1500" }).preflightTimeoutMs).toBe(1500);
  });
});

describe("متى يعمل الفحص المسبق أصلاً", () => {
  test("مُطفأ ⇒ لا استعلام فحص إطلاقاً", async () => {
    const { guard, made } = harness({ behaviours: ["ok"], config: { preflight: false } });
    guard.current();
    expect((await guard.ensureLive()).action).toBe("disabled");
    expect(made[0].calls.queries).toBe(0);
  });

  test("عميل جديد لم ينجح له استعلام بعد ⇒ لا فحص: لا مقبس قديم يُفحَص", async () => {
    const { guard, made } = harness({ behaviours: ["ok"] });
    expect((await guard.ensureLive()).action).toBe("skipped-cold");
    expect(made[0].calls.queries).toBe(0);
  });

  test("آخر نجاح قريب ⇒ لا فحص: لا ثمن تحت حمل متواصل", async () => {
    const { guard, advanceClock, made } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.noteHealthy();
    advanceClock(1000);
    const result = await guard.ensureLive();
    expect(result.action).toBe("skipped-fresh");
    expect(result.idleMs).toBe(1000);
    expect(made[0].calls.queries).toBe(0);
  });

  test("بعد فجوة خمول ⇒ فحص واحد ينجح ويُحدِّث آخر نجاح", async () => {
    const { guard, advanceClock, made } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.noteHealthy();
    advanceClock(9000);
    expect((await guard.ensureLive()).action).toBe("passed");
    expect(made[0].calls.queries).toBe(1);
    // صار العميل «حيّاً الآن»، فالطلب التالي لا يفحص مرّة ثانية.
    expect((await guard.ensureLive()).action).toBe("skipped-fresh");
    expect(made[0].calls.queries).toBe(1);
  });

  test("فحص واحد مشترك بين طلبات متزامنة، لا فحص لكل طلب", async () => {
    const { guard, advanceClock, made } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.noteHealthy();
    advanceClock(9000);
    const [a, b, c] = await Promise.all([
      guard.ensureLive(),
      guard.ensureLive(),
      guard.ensureLive(),
    ]);
    expect([a.action, b.action, c.action]).toEqual(["passed", "passed", "passed"]);
    expect(made[0].calls.queries).toBe(1);
  });
});

describe("مقبس ميت: الفحص يتعلّق، فيُعاد إنشاء العميل ويُتلَف القديم", () => {
  test("انتهاء مهلة الفحص ⇒ إتلاف القديم بـ{timeout:0} وعميل جديد", async () => {
    vi.useFakeTimers();
    const { guard, advanceClock, made } = harness({ behaviours: ["hang", "ok"] });
    guard.current();
    guard.noteHealthy();
    advanceClock(9000);

    const pending = guard.ensureLive();
    await vi.advanceTimersByTimeAsync(DB_RESILIENCE_DEFAULTS.preflightTimeoutMs + 10);
    const result = await pending;

    expect(result.action).toBe("timed-out");
    expect(result.recycle).toEqual({ recycled: true, generation: 2 });
    // الإتلاف هو ما يرفض الوعود المعلَّقة فعلياً — راجع terminate() في
    // postgres.js. فبلا هذا السطر لا شيء يُنهي التعليق.
    expect(made[0].calls.ended).toBe(1);
    expect(made[0].calls.endOptions[0]).toEqual({ timeout: 0 });
    expect(guard.current()).toBe(made[1].client);
    expect(guard.stats().generation).toBe(2);
  });

  test("العميل الجديد يبدأ بارداً، فلا يُفحَص فوراً ولا تنشأ حلقة فحص/إتلاف", async () => {
    vi.useFakeTimers();
    const { guard, advanceClock } = harness({ behaviours: ["hang", "hang"] });
    guard.current();
    guard.noteHealthy();
    advanceClock(9000);
    const pending = guard.ensureLive();
    await vi.advanceTimersByTimeAsync(DB_RESILIENCE_DEFAULTS.preflightTimeoutMs + 10);
    await pending;

    expect((await guard.ensureLive()).action).toBe("skipped-cold");
    expect(guard.stats().recycles).toBe(1);
  });

  test("خطأ اتصال صريح ⇒ إعادة إنشاء كذلك، ويُبلَّغ الرمز وحده", async () => {
    const { guard, advanceClock, made } = harness({ behaviours: ["error", "ok"] });
    guard.current();
    guard.noteHealthy();
    advanceClock(9000);
    const result = await guard.ensureLive();
    expect(result.action).toBe("failed");
    expect(result.errorCode).toBe("CONNECTION_CLOSED");
    expect(result.recycle).toMatchObject({ recycled: true });
    expect(made[0].calls.ended).toBe(1);
    expect(JSON.stringify(result)).not.toContain("socket is gone");
  });
});

describe("سلامة الطلبيات: لا إتلاف أثناء معاملة كتابة", () => {
  test("معاملة جارية ⇒ يُؤجَّل الإتلاف ولا يُلمَس العميل", () => {
    const { guard, made } = harness({ behaviours: ["ok", "ok"] });
    const lease = guard.leaseForWrite(60_000);
    expect(lease.client).toBe(made[0].client);

    const outcome = guard.requestRecycle("test");
    expect(outcome).toEqual({
      recycled: false,
      reason: "deferred-write-in-flight",
      writesInFlight: 1,
    });
    expect(made[0].calls.ended).toBe(0);
    expect(guard.current()).toBe(made[0].client);
    expect(guard.stats().condemned).toBe(true);
    lease.release();
    expect(made[0].calls.ended).toBe(1);
  });

  test("ينفَّذ التأجيل عند انتهاء آخر معاملة — لا قبلها", () => {
    const { guard, made } = harness({ behaviours: ["ok", "ok"] });
    const first = guard.leaseForWrite(60_000);
    const second = guard.leaseForWrite(60_000);
    guard.requestRecycle("test");

    first.release();
    expect(made[0].calls.ended).toBe(0);

    second.release();
    expect(made[0].calls.ended).toBe(1);
    expect(guard.stats().generation).toBe(2);
  });

  test("معاملة بلا حكم مسبق لا تُسبّب أي إتلاف عند انتهائها", () => {
    const { guard, made } = harness({ behaviours: ["ok", "ok"] });
    guard.leaseForWrite(60_000).release();
    expect(made[0].calls.ended).toBe(0);
    expect(guard.stats().generation).toBe(1);
  });

  test("الفحص المتعلِّق أثناء كتابة لا يُتلف شيئاً — يُؤجَّل فقط", async () => {
    vi.useFakeTimers();
    const { guard, advanceClock, made } = harness({ behaviours: ["hang", "ok"] });
    guard.current();
    guard.noteHealthy();
    guard.leaseForWrite(60_000);
    advanceClock(9000);

    const pending = guard.ensureLive();
    await vi.advanceTimersByTimeAsync(DB_RESILIENCE_DEFAULTS.preflightTimeoutMs + 10);
    const result = await pending;

    expect(result.action).toBe("timed-out");
    expect(result.recycle).toMatchObject({ reason: "deferred-write-in-flight" });
    expect(made[0].calls.ended).toBe(0);
  });
});

describe("حدود الإتلاف", () => {
  test("فترة تهدئة تمنع حلقة إتلاف متسارعة", () => {
    const { guard, advanceClock, made } = harness({ behaviours: ["ok", "ok", "ok"] });
    guard.current();
    expect(guard.requestRecycle("first")).toMatchObject({ recycled: true });
    advanceClock(1000);
    expect(guard.requestRecycle("second")).toEqual({ recycled: false, reason: "cooldown" });
    advanceClock(DB_RESILIENCE_DEFAULTS.recycleCooldownMs);
    expect(guard.requestRecycle("third")).toMatchObject({ recycled: true });
    expect(made.filter((m) => m.calls.ended > 0)).toHaveLength(2);
  });

  test("بلا عميل بعد: لا شيء يُتلَف", () => {
    const { guard } = harness({ behaviours: ["ok"] });
    expect(guard.requestRecycle("x")).toEqual({ recycled: false, reason: "no-client" });
  });

  test("DB_HANG_ESCALATION=off ⇒ تعليق استعلام لا يُتلف العميل", () => {
    const { guard, made } = harness({ behaviours: ["ok", "ok"], config: { escalation: false } });
    guard.current();
    expect(guard.noteHangEscalation("hang").recycled).toBe(false);
    expect(made[0].calls.ended).toBe(0);
    expect(guard.stats().escalations).toBe(0);
  });

  test("مُفعَّلاً ⇒ تعليق استعلام يُتلف العميل ويُعدّ", () => {
    const { guard, made } = harness({ behaviours: ["ok", "ok"] });
    guard.current();
    expect(guard.noteHangEscalation("hang")).toMatchObject({ recycled: true });
    expect(made[0].calls.ended).toBe(1);
    expect(guard.stats().escalations).toBe(1);
  });
});

describe("الفحص لا يرمي أبداً", () => {
  test("فشل إنشاء العميل يُبلَّغ كنتيجة، لا كاستثناء يُسقِط القراءة", async () => {
    const guard = new ConnectionGuard({
      create: () => {
        throw new Error("DATABASE_URL غير معرَّف");
      },
    });
    const result = await guard.ensureLive();
    expect(result.action).toBe("failed");
    expect(result.errorCode).toBe("Error");
  });
});

describe("classifyStatement — من النص الذي كتبه مطوِّر، لا من قيم المستخدم", () => {
  const read = (parts: readonly string[] | null) => classifyStatement(parts);

  test("قراءة صريحة", () => {
    expect(read(["select id, name from public.products where id = ", ""])).toBe("read");
    expect(read(["  \n select count(*)::int as n from public.orders"])).toBe("read");
    expect(read(["-- تعليق\n select 1"])).toBe("read");
    expect(read(["select * from public.orders order by created_at desc limit ", ""])).toBe("read");
  });

  test("كل كتابة تُصنَّف كتابةً، ولو جاءت في أجزاء قالَب متعدّدة", () => {
    expect(read(["insert into public.orders (a) values (", ")"])).toBe("write");
    expect(read(["update public.product_variants set stock_quantity = stock_quantity - ", ""])).toBe("write");
    expect(read(["delete from public.categories where id = ", ""])).toBe("write");
    expect(read(["\n        insert into public.order_status_history (order_id) values (", ")"])).toBe("write");
  });

  test("CTE تُخفي كتابةً داخلها ⇒ كتابة", () => {
    expect(read(["with moved as (insert into public.a select 1 returning id) select * from moved"])).toBe(
      "write"
    );
  });

  test("ما لا نفهمه كتابةٌ — لا قراءة", () => {
    expect(read(null)).toBe("write");
    expect(read([])).toBe("write");
    expect(read(["order by sale_price asc"])).toBe("write");
    expect(read(["select set_config('statement_timeout', ", ", false)"])).toBe("write");
    expect(read(["truncate public.probe_writes"])).toBe("write");
  });

  test("قيمة زبون لا يمكن أن تُغيّر التصنيف — القيم ليست من الأجزاء الثابتة", () => {
    // قالَب حقيقي: sql`select * from products where name = ${userInput}`
    // الأجزاء الثابتة وحدها هي ما يُمرَّر، والقيمة تمرّ كمعامل مربوط.
    expect(read(["select * from public.products where name = ", ""])).toBe("read");
  });
});

describe("موعد نهاية عقد الكتابة — حماية لا قُفل أبدي", () => {
  test("عقد لم يتجاوز موعده يمنع الإتلاف", () => {
    const { guard, made } = harness({ behaviours: ["ok", "ok"] });
    guard.leaseForWrite(13_000);
    expect(guard.requestRecycle("read-hang")).toMatchObject({
      reason: "deferred-write-in-flight",
      writesInFlight: 1,
    });
    expect(made[0].calls.ended).toBe(0);
  });

  test("وبعد موعده يتوقّف عن المنع — فلا تُقفل كتابةٌ معلَّقة استعادةَ القراءات", () => {
    const { guard, advanceClock, made } = harness({ behaviours: ["ok", "ok"] });
    guard.leaseForWrite(13_000);
    advanceClock(13_001);
    expect(guard.stats().writesInFlight).toBe(1);
    expect(guard.stats().writesBlockingRecycle).toBe(0);
    expect(guard.requestRecycle("read-hang")).toMatchObject({ recycled: true });
    expect(made[0].calls.ended).toBe(1);
  });

  test("عقد بلا موعد (off) يمنع إلى الأبد", () => {
    const { guard, advanceClock, made } = harness({ behaviours: ["ok", "ok"] });
    guard.leaseForWrite(Number.POSITIVE_INFINITY);
    advanceClock(10 * 60 * 1000);
    expect(guard.requestRecycle("read-hang")).toMatchObject({
      reason: "deferred-write-in-flight",
    });
    expect(made[0].calls.ended).toBe(0);
  });

  test("عقد كتابةٍ واحد نشط يكفي لمنع الإتلاف ولو تجاوز غيره موعده", () => {
    const { guard, advanceClock, made } = harness({ behaviours: ["ok", "ok"] });
    guard.leaseForWrite(5_000);
    advanceClock(6_000);
    guard.leaseForWrite(13_000);
    expect(guard.stats().writesBlockingRecycle).toBe(1);
    expect(guard.requestRecycle("read-hang")).toMatchObject({
      reason: "deferred-write-in-flight",
    });
    expect(made[0].calls.ended).toBe(0);
  });
});

describe("leaseForClient — العقد يُرفَع على العميل الذي بُني عليه الاستعلام", () => {
  test("عميل ما زال هو الحالي ⇒ عقد حقيقي", () => {
    const { guard, made } = harness({ behaviours: ["ok", "ok"] });
    const client = guard.current();
    expect(guard.leaseForClient(client, 13_000).leased).toBe(true);
    expect(guard.stats().writesBlockingRecycle).toBe(1);
    expect(made).toHaveLength(1);
  });

  test("عميل أُتلف قبل التسليح ⇒ عقد فارغ، ولا حماية لشريحة لا كتابة فيها", () => {
    const { guard, made } = harness({ behaviours: ["ok", "ok"] });
    const stale = guard.current();
    guard.requestRecycle("whatever");
    expect(guard.current()).not.toBe(stale);

    const lease = guard.leaseForClient(stale, 13_000);
    expect(lease.leased).toBe(false);
    // الشريحة الجديدة لم تُحمَ خطأً بكتابةٍ تجري على عميل أُتلف أصلاً.
    expect(guard.stats().writesBlockingRecycle).toBe(0);
    expect(made[1].calls.ended).toBe(0);
  });
});
