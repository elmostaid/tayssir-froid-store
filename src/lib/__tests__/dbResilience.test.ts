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
// نصّها المنفصل على PostgreSQL حقيقي (scripts/db-rotation-scenarios.mjs).
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
  test("بلا أي متغيّر: التدوير والتصعيد مُفعَّلان بالقيم الموثَّقة", () => {
    expect(readDbResilienceConfig({})).toEqual(DB_RESILIENCE_DEFAULTS);
    expect(DB_RESILIENCE_DEFAULTS.rotateAfterIdleMs).toBe(15000);
  });

  test("off يُطفئ — بالمفتاح الجديد أو القديم — وهذه خطة الرجوع بلا نشر", () => {
    expect(readDbResilienceConfig({ DB_IDLE_ROTATION: "off" }).rotation).toBe(false);
    expect(readDbResilienceConfig({ DB_LIVENESS_PREFLIGHT: "off" }).rotation).toBe(false);
    expect(readDbResilienceConfig({ DB_HANG_ESCALATION: "off" }).escalation).toBe(false);
  });

  test("قيمة مشوَّهة أو خارج النطاق تعود إلى الافتراضي، لا إلى صفر", () => {
    const d = DB_RESILIENCE_DEFAULTS;
    expect(readDbResilienceConfig({ DB_STALE_AFTER_MS: "abc" }).rotateAfterIdleMs).toBe(d.rotateAfterIdleMs);
    expect(readDbResilienceConfig({ DB_STALE_AFTER_MS: "10" }).rotateAfterIdleMs).toBe(d.rotateAfterIdleMs);
    expect(readDbResilienceConfig({ DB_STALE_AFTER_MS: "30000" }).rotateAfterIdleMs).toBe(30000);
  });
});

describe("التدوير بعد الخمول — بلا أي استعلام فحص", () => {
  test("لا يُرسَل أي شيء إلى القاعدة من ensureLive في أي حالة", async () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"] });
    guard.current();
    const done = guard.trackQuery(made[0].client);
    done();
    advanceClock(60_000);
    await guard.ensureLive();
    expect(made.every((m) => m.calls.queries === 0)).toBe(true);
  });

  test("عميل جديد لم يجرِ عليه شيء ⇒ لا تدوير", async () => {
    const { guard, made } = harness({ behaviours: ["ok"] });
    expect((await guard.ensureLive()).action).toBe("skipped-cold");
    expect(made).toHaveLength(1);
  });

  test("نشاط قريب ⇒ لا تدوير", async () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.trackQuery(made[0].client)();
    advanceClock(14_000);
    expect((await guard.ensureLive()).action).toBe("skipped-fresh");
    expect(made).toHaveLength(1);
  });

  test("فجوة خمول ⇒ عميل جديد، والقديم يُقاعَد بـend مع مهلة — لا timeout:0", async () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.trackQuery(made[0].client)();
    advanceClock(15_000);
    const result = await guard.ensureLive();
    expect(result.action).toBe("rotated");
    expect(made).toHaveLength(2);
    expect(guard.current()).toBe(made[1].client);
    expect(made[0].calls.endOptions).toEqual([{ timeout: 2 }]);
  });

  test("استعلام عالق من قبل تجميد يُحسب نشاطاً قديماً لا حديثاً ⇒ تدوير", async () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.trackQuery(made[0].client); // لم ينتهِ أبداً: جُمِّدت الدالة
    advanceClock(120_000);
    expect((await guard.ensureLive()).action).toBe("rotated");
    // تجاوز سقفه منذ زمن ⇒ أقلّ مهلة تصريف.
    expect(made[0].calls.endOptions).toEqual([{ timeout: 2 }]);
  });

  test("طلبات متزامنة بعد الخمول: تدوير واحد فقط", async () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.trackQuery(made[0].client)();
    advanceClock(30_000);
    const results = await Promise.all([guard.ensureLive(), guard.ensureLive(), guard.ensureLive()]);
    expect(results.map((r) => r.action)).toEqual(["rotated", "skipped-cold", "skipped-cold"]);
    expect(made).toHaveLength(2);
  });

  test("مُطفأ ⇒ نفس العميل مهما طال الخمول", async () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"], config: { rotation: false } });
    guard.current();
    guard.trackQuery(made[0].client)();
    advanceClock(600_000);
    expect((await guard.ensureLive()).action).toBe("disabled");
    expect(made).toHaveLength(1);
  });
});

describe("مهلة التصريف: لا يُقطَع استعلام سليم ضمن سقفه", () => {
  test("استعلام بدأ قبل ثانية ⇒ يبقى له 12.5 ثانية", () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.trackQuery(made[0].client);
    advanceClock(1_000);
    const outcome = guard.requestRecycle("forced");
    expect(outcome).toMatchObject({ recycled: true, drainMs: 12_500 });
    expect(made[0].calls.endOptions).toEqual([{ timeout: 12.5 }]);
  });

  test("لا استعلام جارٍ ⇒ أقلّ مهلة (2s)، والإغلاق فوري عملياً لأن لا شيء ينتظر", () => {
    const { guard } = harness({ behaviours: ["ok"] });
    guard.current();
    expect(guard.requestRecycle("forced")).toMatchObject({ recycled: true, drainMs: 2_000 });
  });

  test("السقف لا يُتجاوز أبداً: 13.5 ثانية", () => {
    const { guard, made } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.trackQuery(made[0].client);
    expect(guard.requestRecycle("forced")).toMatchObject({ drainMs: 13_500 });
  });
});

describe("سلامة الطلبيات: لا تقاعد أثناء كتابة", () => {
  test("معاملة جارية ⇒ يُؤجَّل التدوير ولا يُلمَس العميل، ويُنفَّذ بعدها", async () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"] });
    const lease = guard.leaseForWrite(75_000);
    guard.trackQuery(made[0].client)();
    advanceClock(30_000);
    const result = await guard.ensureLive();
    expect(result.action).toBe("rotation-deferred");
    expect(made[0].calls.ended).toBe(0);
    expect(guard.stats().condemned).toBe(true);
    lease.release();
    expect(made[0].calls.ended).toBe(1);
    expect(guard.current()).toBe(made[1].client);
  });
});

describe("حدود التقاعد", () => {
  test("فترة تهدئة تمنع حلقة تقاعد متسارعة بسبب التعليق — لا بسبب الخمول", () => {
    const { guard, made, advanceClock } = harness({ behaviours: ["ok"] });
    guard.current();
    expect(guard.noteHangEscalation("hang", made[0].client).recycled).toBe(true);
    expect(guard.noteHangEscalation("hang", made[1].client)).toEqual({ recycled: false, reason: "cooldown" });
    advanceClock(10_001);
    expect(guard.noteHangEscalation("hang", made[1].client).recycled).toBe(true);
  });

  test("تعليق على عميل غير الحالي لا يُقاعِد الحالي", () => {
    const { guard, made } = harness({ behaviours: ["ok"] });
    guard.current();
    guard.requestRecycle("forced");
    expect(guard.noteHangEscalation("hang", made[0].client)).toEqual({ recycled: false, reason: "not-current" });
    expect(made[1].calls.ended).toBe(0);
  });

  test("DB_HANG_ESCALATION=off ⇒ تعليق استعلام لا يُقاعِد العميل", () => {
    const { guard, made } = harness({ behaviours: ["ok"], config: { escalation: false } });
    guard.current();
    expect(guard.noteHangEscalation("hang", made[0].client).recycled).toBe(false);
    expect(made[0].calls.ended).toBe(0);
  });

  test("بلا عميل بعد: لا شيء يُقاعَد", () => {
    const { guard } = harness({ behaviours: ["ok"] });
    expect(guard.requestRecycle("forced")).toEqual({ recycled: false, reason: "no-client" });
  });
});

describe("ensureLive لا ترمي أبداً", () => {
  test("فشل إنشاء العميل يُبلَّغ كنتيجة، لا كاستثناء يُسقِط القراءة", async () => {
    const guard = new ConnectionGuard({
      create: () => {
        throw Object.assign(new Error("DATABASE_URL missing"), { code: "NO_URL" });
      },
      config: () => DB_RESILIENCE_DEFAULTS,
    });
    await expect(guard.ensureLive()).resolves.toMatchObject({ action: "failed", errorCode: "NO_URL" });
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

describe("السجلّ: سطرٌ لكل حدث حقيقي فقط", () => {
  test("الحالات الغالبة لا تُسجَّل، والتدوير يُسجَّل بسببه ومهلته", async () => {
    const events: { kind: string; detail: Record<string, unknown> }[] = [];
    let now = 0;
    const created: ReturnType<typeof fakeClient>[] = [];
    const guard = new ConnectionGuard({
      create: () => {
        const c = fakeClient("ok");
        created.push(c);
        return c.client;
      },
      now: () => now,
      config: () => DB_RESILIENCE_DEFAULTS,
      onEvent: (e) => events.push(e),
    });
    await guard.ensureLive();
    guard.trackQuery(created[0].client)();
    now += 1_000;
    await guard.ensureLive();
    expect(events).toEqual([]);

    now += 20_000;
    await guard.ensureLive();
    expect(events.map((e) => e.kind)).toEqual(["recycle"]);
    expect(events[0].detail).toMatchObject({ reason: "idle-gap", generation: 2, drainMs: 2_000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(events.map((e) => e.kind)).toEqual(["recycle", "retired"]);
  });
});
