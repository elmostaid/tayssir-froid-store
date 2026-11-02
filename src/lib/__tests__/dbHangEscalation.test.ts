import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// الفجوة التي يُغلقها هذا الملف، بعبارة واحدة: `query.cancel()` في
// postgres.js لا يرفض الوعد محلياً إلا إذا كان الاستعلام ما زال في طابور
// العميل. أما استعلام أُرسل على **مقبس ميت**، فـcancel() يفتح اتصالاً
// جديداً وينتظر رداً لن يأتي (index.js:350 ← connection.js:145)، فيبقى
// الوعد معلَّقاً إلى سقف المنصّة — 300 ثانية على Vercel.
//
// فالعميل المُلفَّق هنا يحاكي ذلك بأمانة: cancel() **لا يفعل شيئاً**،
// كما في الواقع تماماً. و`end({ timeout })` يحاكي postgres.js
// (index.js:365): ينتظر اكتمال ما يجري، فإن انقضت المهلة رفض الباقي كما
// يفعل terminate() حرفياً (connection.js:422). و`timeout: 0` رفضٌ فوري.

const ORIGINAL = {
  DATABASE_URL: process.env.DATABASE_URL,
  DB_HANG_ESCALATION: process.env.DB_HANG_ESCALATION,
};

class DeadSocketQuery<T> extends Promise<T> {
  cancelCalls = 0;
  handled = false;
  rejectWith!: (reason: unknown) => void;
  resolveWith!: (value: T) => void;
  settled = false;
  onSettle: Array<() => void> = [];

  static get [Symbol.species]() {
    return Promise;
  }

  static create<V>(): DeadSocketQuery<V> {
    let rejectWith!: (reason: unknown) => void;
    let resolveWith!: (value: V) => void;
    const q = new DeadSocketQuery<V>((res, rej) => {
      resolveWith = res as (value: V) => void;
      rejectWith = rej;
    });
    q.rejectWith = (reason) => {
      if (q.settled) return;
      q.settled = true;
      rejectWith(reason);
      for (const f of q.onSettle) f();
    };
    q.resolveWith = (value) => {
      if (q.settled) return;
      q.settled = true;
      resolveWith(value);
      for (const f of q.onSettle) f();
    };
    return q;
  }

  /** مقبس ميت: الإلغاء يُطلَب ولا ينتج عنه أي رفض. هذا هو بيت الداء. */
  cancel() {
    this.cancelCalls += 1;
  }

  then(...args: unknown[]) {
    this.handled = true;
    return (Promise.prototype.then as (...a: unknown[]) => unknown).apply(
      this,
      args
    ) as never;
  }
}

type FakeClient = {
  queries: DeadSocketQuery<unknown>[];
  endCalls: unknown[];
  beginCalls: number;
};

const clients: FakeClient[] = [];

vi.mock("postgres", () => {
  const makeClient = () => {
    const state: FakeClient = { queries: [], endCalls: [], beginCalls: 0 };
    clients.push(state);

    const client = (() => {
      const q = DeadSocketQuery.create<unknown>();
      state.queries.push(q);
      return q;
    }) as unknown as Record<string, unknown> & ((...a: unknown[]) => unknown);

    client.end = async (options?: unknown) => {
      state.endCalls.push(options);
      const timeout = (options as { timeout?: number } | undefined)?.timeout ?? null;
      // جزء الاستعلام (fragment) لم يُسلَّم أبداً (handle() لم يُستدعَ
      // عليه)، فلا يُنتظَر ولا يُرفَض — كما في postgres.js.
      const pending = () => state.queries.filter((q) => q.handled && !q.settled);
      const destroy = () => {
        for (const q of pending()) {
          q.rejectWith(
            Object.assign(new Error("write CONNECTION_DESTROYED"), {
              code: "CONNECTION_DESTROYED",
            })
          );
        }
      };
      if (timeout === 0) return destroy();
      await new Promise<void>((resolve) => {
        const check = () => {
          if (pending().length === 0) {
            if (timer) clearTimeout(timer);
            resolve();
          }
        };
        const timer =
          timeout === null
            ? undefined
            : setTimeout(() => {
                destroy();
                resolve();
              }, timeout * 1000);
        for (const q of pending()) q.onSettle.push(check);
        check();
      });
    };

    (client as Record<string, unknown>).begin = async (fn: (trx: unknown) => Promise<unknown>) => {
      state.beginCalls += 1;
      return fn(client);
    };

    return client;
  };
  return { default: () => makeClient() };
});

beforeEach(() => {
  vi.useFakeTimers();
  clients.length = 0;
  vi.resetModules();
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
  delete process.env.DB_HANG_ESCALATION;
  delete globalThis.__tayssirDbGuard;
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.__tayssirDbGuard;
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});


const rejectedCode = (q: unknown) =>
  (q as Promise<unknown>).then(
    () => "resolved",
    (error: { code?: string }) => `rejected:${error.code}`
  );

describe("استعلام معلَّق على مقبس ميت", () => {
  test("بلا الإصلاح (DB_HANG_ESCALATION=off): يُطلَب الإلغاء ويبقى الوعد معلَّقاً", async () => {
    process.env.DB_HANG_ESCALATION = "off";
    const { sql } = await import("@/lib/db");

    const pending = sql`select 1`;
    let settled = false;
    void (pending as unknown as Promise<unknown>).then(
      () => (settled = true),
      () => (settled = true)
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(clients[0].queries[0].cancelCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(settled).toBe(false);
    expect(clients[0].endCalls).toHaveLength(0);
  });

  test("مع الإصلاح: عند 13 ثانية يُقاعَد العميل بمهلة تصريف — لا إتلاف فوري", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    const outcome = rejectedCode(sql`select 1`);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(clients[0].queries[0].cancelCalls).toBe(1);
    expect(clients[0].endCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3_000);
    // أحدث استعلام جارٍ هو المعلَّق نفسه وقد تجاوز سقفه ⇒ أقلّ مهلة (2s).
    expect(clients[0].endCalls).toEqual([{ timeout: 2 }]);
    expect(dbGuard.stats().retiring).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(outcome).resolves.toBe("rejected:CONNECTION_DESTROYED");
    expect(dbGuard.stats().retiring).toBe(0);
  });

  test("والطلب التالي يُنفَّذ على عميل جديد، لا على العميل المُقاعَد", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    void (sql`select 1` as unknown as Promise<unknown>).catch(() => {});
    await vi.advanceTimersByTimeAsync(13_100);
    expect(dbGuard.stats().generation).toBe(2);

    void (sql`select 2` as unknown as Promise<unknown>).catch(() => {});
    expect(clients).toHaveLength(2);
    expect(clients[1].queries).toHaveLength(1);
    expect(clients[0].queries).toHaveLength(1);
  });

  test("استعلام يُلغى فعلاً (الفرع السليم في postgres.js) لا يُقاعِد شيئاً", async () => {
    const { sql } = await import("@/lib/db");
    const outcome = (sql`select 1` as unknown as Promise<unknown>).then(
      () => "resolved",
      (e: Error) => `rejected:${e.message}`
    );
    await vi.advanceTimersByTimeAsync(10_000);
    clients[0].queries[0].rejectWith(new Error("57014"));
    await expect(outcome).resolves.toBe("rejected:57014");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(clients[0].endCalls).toHaveLength(0);
  });

  test("استعلام ينجح قبل المهلة: لا إلغاء ولا تقاعد ولا مؤقّت باقٍ", async () => {
    const { sql, dbGuard } = await import("@/lib/db");
    const outcome = (sql`select 1` as unknown as Promise<unknown>).then((v) => v);
    clients[0].queries[0].resolveWith([{ ok: true }]);
    await expect(outcome).resolves.toEqual([{ ok: true }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clients[0].queries[0].cancelCalls).toBe(0);
    expect(clients[0].endCalls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(dbGuard.stats().inflight).toBe(0);
  });
});

describe("اتصال واحد معطّل لا يُسقط الاستعلامات السليمة الجارية معه", () => {
  test("قراءة معلَّقة + قراءة سليمة تستغرق 4 ثوان بدأت قبل التصعيد بثانية: السليمة تكتمل", async () => {
    const { sql } = await import("@/lib/db");

    const hung = rejectedCode(sql`select 1 from public.products`);
    await vi.advanceTimersByTimeAsync(12_000);
    const healthy = rejectedCode(sql`select 2 from public.orders`);

    await vi.advanceTimersByTimeAsync(1_100); // التصعيد عند 13s
    // التصعيد عند 13 ثانية بالضبط، والتصريف محسوب من أحدث استعلام:
    // 12 + 13.5 − 13 = 12.5 ثانية.
    expect(clients[0].endCalls).toHaveLength(1);
    expect((clients[0].endCalls[0] as { timeout: number }).timeout).toBeCloseTo(12.5, 1);

    // السليمة تُكمل بعد 4 ثوان من بدئها — بعد التقاعد بـ3 ثوان تقريباً.
    await vi.advanceTimersByTimeAsync(2_900);
    clients[0].queries[1].resolveWith([{ ok: 2 }]);
    await expect(healthy).resolves.toBe("resolved");

    // والمعلَّقة وحدها تُرفَض عند انتهاء التصريف.
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(hung).resolves.toBe("rejected:CONNECTION_DESTROYED");
  });

  test("خمسة استعلامات متزامنة وواحد منها معلَّق: الأربعة تكتمل، والمعلَّق وحده يُرفَض", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    const outcomes = [1, 2, 3, 4, 5].map((n) => rejectedCode(sql`select ${n} as n`));
    // الأربعة الأولى تردّ في أزمنة مختلفة، والخامس على مقبس ميت.
    for (const [i, delay] of [200, 900, 1_500, 2_500].entries()) {
      setTimeout(() => clients[0].queries[i].resolveWith([{ n: i + 1 }]), delay);
    }
    await vi.advanceTimersByTimeAsync(13_100);
    expect(clients[0].endCalls).toEqual([{ timeout: 2 }]);
    await vi.advanceTimersByTimeAsync(2_100);

    expect(await Promise.all(outcomes)).toEqual([
      "resolved",
      "resolved",
      "resolved",
      "resolved",
      "rejected:CONNECTION_DESTROYED",
    ]);
    expect(dbGuard.stats().retiring).toBe(0);
  });

  test("استعلام يتجاوز ثانيتين أثناء تدوير قسري لا يُقطَع", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    const slow = rejectedCode(sql`select pg_sleep(6)`);
    await vi.advanceTimersByTimeAsync(1_000);
    const outcome = dbGuard.requestRecycle("forced");
    expect(outcome.recycled).toBe(true);
    // يبقى للبطيء حتى سقفه الطبيعي: 13.5 − 1 = 12.5 ثانية — لا ثانيتان.
    expect((clients[0].endCalls[0] as { timeout: number }).timeout).toBeCloseTo(12.5, 1);

    await vi.advanceTimersByTimeAsync(5_000); // اكتمل عند 6 ثوان
    clients[0].queries[0].resolveWith([{ pg_sleep: "" }]);
    await expect(slow).resolves.toBe("resolved");
    await vi.advanceTimersByTimeAsync(0);
    expect(dbGuard.stats().retiring).toBe(0);
  });

  test("تعليقٌ على عميلٍ مُقاعَد أصلاً لا يُقاعِد العميل الجديد السليم", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    void (sql`select 1` as unknown as Promise<unknown>).catch(() => {});
    await vi.advanceTimersByTimeAsync(5_000);
    // تدوير (مثلاً بعد خمول) والاستعلام ما زال جارياً على القديم.
    dbGuard.requestRecycle("forced");
    expect(dbGuard.stats().generation).toBe(2);

    // يبلغ القديمُ سقف تصعيده: لا يجوز أن يمسّ العميل الجديد.
    await vi.advanceTimersByTimeAsync(8_100);
    expect(dbGuard.stats().generation).toBe(2);
    expect(dbGuard.stats().escalations).toBe(0);
    expect(clients).toHaveLength(2);
    expect(clients[1].endCalls).toHaveLength(0);
  });

  test("لا تراكم: عشرة تدويرات متتالية تعود كلها إلى صفر عملاء في التصريف", async () => {
    const { sql, dbGuard } = await import("@/lib/db");
    for (let i = 0; i < 10; i++) {
      void (sql`select ${i}` as unknown as Promise<unknown>).catch(() => {});
      dbGuard.requestRecycle("forced", { ignoreCooldown: true });
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(dbGuard.stats().retiredClients).toBe(10);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(dbGuard.stats().retiring).toBe(0);
    // كل عميل مُقاعَد طُلب إنهاؤه مرّة واحدة بالضبط.
    expect(clients.slice(0, 10).every((c) => c.endCalls.length === 1)).toBe(true);
  });
});

describe("سلامة الطلبيات: كتابة جارية تمنع التقاعد", () => {
  test("لا يُقاعَد العميل أثناء معاملة، ويُقاعَد بعدها إن كان محكوماً عليه", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    let releaseTransaction!: () => void;
    const gate = new Promise<void>((r) => (releaseTransaction = r));
    const transaction = sql.begin(async () => {
      await gate;
      return "committed";
    });

    void (sql`select 1` as unknown as Promise<unknown>).catch(() => {});
    await vi.advanceTimersByTimeAsync(13_100);

    expect(dbGuard.stats().writesInFlight).toBe(1);
    expect(dbGuard.stats().condemned).toBe(true);
    expect(dbGuard.stats().recyclesDeferred).toBe(1);
    expect(clients[0].endCalls).toHaveLength(0);

    releaseTransaction();
    await expect(transaction).resolves.toBe("committed");
    expect(clients[0].endCalls).toHaveLength(1);
    expect(dbGuard.stats().generation).toBe(2);
    expect(dbGuard.stats().writesInFlight).toBe(0);
  });

  test("معاملة فشلت تُنقِص العدّاد كذلك", async () => {
    const { sql, dbGuard } = await import("@/lib/db");
    await expect(
      sql.begin(async () => {
        throw new Error("فشل منطقي داخل المعاملة");
      })
    ).rejects.toThrow("فشل منطقي");
    expect(dbGuard.stats().writesInFlight).toBe(0);
  });

  test("عبارة كتابة مفردة تمنع تقاعداً سببه تعليق قراءة، ثم يُنفَّذ بعد حسمها", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    const write = sql`update public.orders set delivery_fee = ${30} where id = ${1}`;
    const writeOutcome = rejectedCode(write);
    void (sql`select count(*) from public.orders` as unknown as Promise<unknown>).catch(() => {});
    await vi.advanceTimersByTimeAsync(13_100);

    expect(dbGuard.stats().writesBlockingRecycle).toBe(1);
    expect(clients[0].endCalls).toHaveLength(0);
    expect(clients[0].queries[0].settled).toBe(false);

    clients[0].queries[0].resolveWith([{ id: 1 }]);
    await expect(writeOutcome).resolves.toBe("resolved");
    expect(clients[0].endCalls).toHaveLength(1);
    expect(dbGuard.stats().generation).toBe(2);
  });

  test("عبارة الكتابة لا تُصعِّد بنفسها أبداً", async () => {
    const { sql, dbGuard } = await import("@/lib/db");
    void (sql`update public.orders set actual_delivery_cost = ${12} where id = ${7}` as unknown as Promise<unknown>).catch(() => {});
    await vi.advanceTimersByTimeAsync(70_000);
    expect(clients[0].queries[0].cancelCalls).toBe(1);
    expect(clients[0].endCalls).toHaveLength(0);
    expect(dbGuard.stats().escalations).toBe(0);
  });
});

describe("لا رفض غير مُلتقَط", () => {
  test("تقاعد عميل عليه استعلامات معلَّقة وجزء استعلام لا يُنتج unhandledRejection", async () => {
    const captured: unknown[] = [];
    const onUnhandled = (reason: unknown) => captured.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { sql } = await import("@/lib/db");
      const outcome = (sql`select 1 from public.products` as unknown as Promise<unknown>).then(
        () => "ok",
        () => "failed"
      );
      void (sql`select 2 from public.products` as unknown as Promise<unknown>).catch(() => {});
      expect(sql`order by sale_price asc`).toBeDefined();

      await vi.advanceTimersByTimeAsync(15_200);
      await expect(outcome).resolves.toBe("failed");
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
      expect(captured).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
