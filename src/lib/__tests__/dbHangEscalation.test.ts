import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// الفجوة التي يُغلقها هذا الملف، بعبارة واحدة: `query.cancel()` في
// postgres.js لا يرفض الوعد محلياً إلا إذا كان الاستعلام ما زال في طابور
// العميل. أما استعلام أُرسل على **مقبس ميت**، فـcancel() يفتح اتصالاً
// جديداً وينتظر رداً لن يأتي (index.js:350 ← connection.js:145)، فيبقى
// الوعد معلَّقاً إلى سقف المنصّة — 300 ثانية على Vercel.
//
// فالعميل المُلفَّق هنا يحاكي ذلك بأمانة: cancel() **لا يفعل شيئاً**،
// كما في الواقع تماماً. و`end({ timeout: 0 })` يرفض كل ما هو معلَّق،
// كما يفعل terminate() حرفياً (connection.js:422).

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
      q.settled = true;
      rejectWith(reason);
    };
    q.resolveWith = (value) => {
      q.settled = true;
      resolveWith(value);
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
      // هذا هو ما يفعله terminate() فعلاً: رفض محلي فوري لكل استعلام
      // جارٍ أو مُرسَل، بلا انتظار أي بايت من الخادم.
      for (const q of state.queries) {
        if (!q.settled) q.rejectWith(Object.assign(new Error("write CONNECTION_DESTROYED"), {
          code: "CONNECTION_DESTROYED",
        }));
      }
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

describe("استعلام معلَّق على مقبس ميت — السقف 300 ثانية", () => {
  test("بلا الإصلاح (DB_HANG_ESCALATION=off): يُطلَب الإلغاء ويبقى الوعد معلَّقاً إلى الأبد", async () => {
    process.env.DB_HANG_ESCALATION = "off";
    const { sql } = await import("@/lib/db");

    const pending = sql`select 1`;
    let settled = false;
    void (pending as unknown as Promise<unknown>).then(
      () => (settled = true),
      () => (settled = true)
    );

    // 10 ثوان: مؤقّت db.ts يطلب الإلغاء.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(clients[0].queries[0].cancelCalls).toBe(1);

    // وبعد دقيقة كاملة لا شيء حُسم ولا شيء أُتلف. هذه هي بالضبط النسخة
    // التي يُمسكها waitUntil حتى يقتلها Vercel عند 300 ثانية.
    await vi.advanceTimersByTimeAsync(50_000);
    expect(settled).toBe(false);
    expect(clients[0].endCalls).toHaveLength(0);
  });

  test("مع الإصلاح: يُطلَب الإلغاء، ثم يُتلَف العميل فيُرفَض الوعد عند ~13 ثانية", async () => {
    const { sql } = await import("@/lib/db");

    const pending = sql`select 1`;
    const outcome = (pending as unknown as Promise<unknown>).then(
      () => "resolved",
      (error: { code?: string }) => `rejected:${error.code}`
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(clients[0].queries[0].cancelCalls).toBe(1);
    // مهلة السماح لـcancel() أن يعمل كما ينبغي لو كان الاستعلام في الطابور.
    expect(clients[0].endCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(clients[0].endCalls).toEqual([{ timeout: 0 }]);
    await expect(outcome).resolves.toBe("rejected:CONNECTION_DESTROYED");
  });

  test("والطلب التالي يُنفَّذ على عميل جديد، لا على المقبس الميت", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    const pending = sql`select 1`;
    void (pending as unknown as Promise<unknown>).catch(() => {});
    await vi.advanceTimersByTimeAsync(13_100);

    expect(dbGuard.stats().generation).toBe(2);
    const next = sql`select 2`;
    void (next as unknown as Promise<unknown>).catch(() => {});
    expect(clients).toHaveLength(2);
    expect(clients[1].queries).toHaveLength(1);
    expect(clients[0].queries).toHaveLength(1);
  });

  test("استعلام يُلغى فعلاً (الفرع السليم في postgres.js) لا يُسبّب أي إتلاف", async () => {
    const { sql } = await import("@/lib/db");

    const pending = sql`select 1`;
    const outcome = (pending as unknown as Promise<unknown>).then(
      () => "resolved",
      (e: Error) => `rejected:${e.message}`
    );

    await vi.advanceTimersByTimeAsync(10_000);
    // نحاكي الفرع الذي يعمل فيه cancel() كما ينبغي: رفض محلي بـ57014.
    clients[0].queries[0].rejectWith(new Error("57014"));
    await expect(outcome).resolves.toBe("rejected:57014");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(clients[0].endCalls).toHaveLength(0);
  });

  test("استعلام ينجح قبل المهلة: لا إلغاء ولا إتلاف ولا مؤقّت باقٍ", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    const pending = sql`select 1`;
    const outcome = (pending as unknown as Promise<unknown>).then((v) => v);
    clients[0].queries[0].resolveWith([{ ok: true }]);
    await expect(outcome).resolves.toEqual([{ ok: true }]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(clients[0].queries[0].cancelCalls).toBe(0);
    expect(clients[0].endCalls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    // ونجاحُه هو ما يُعلِن أن المقبس حيّ، فيتخطّى الفحص المسبق نفسه.
    expect(dbGuard.stats().idleMs).not.toBeNull();
  });
});

describe("سلامة الطلبيات: معاملة كتابة جارية تمنع الإتلاف", () => {
  test("لا يُتلَف العميل أثناء معاملة، ويُتلَف بعدها إن كان محكوماً عليه", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((r) => (releaseTransaction = r));

    const transaction = sql.begin(async () => {
      await transactionGate;
      return "committed";
    });

    // أثناء المعاملة: استعلام قراءة يتعلّق ويُستنفد مؤقّته بالكامل.
    const hanging = sql`select 1`;
    void (hanging as unknown as Promise<unknown>).catch(() => {});
    await vi.advanceTimersByTimeAsync(13_100);

    // الحكم صدر، والتنفيذ مؤجَّل — ولا شيء أُتلف.
    expect(dbGuard.stats().writesInFlight).toBe(1);
    expect(dbGuard.stats().condemned).toBe(true);
    expect(dbGuard.stats().recyclesDeferred).toBe(1);
    expect(clients[0].endCalls).toHaveLength(0);

    releaseTransaction();
    await expect(transaction).resolves.toBe("committed");

    // وبعد أن سُجِّلت نتيجة COMMIT، يُنفَّذ الإتلاف المؤجَّل.
    expect(clients[0].endCalls).toEqual([{ timeout: 0 }]);
    expect(dbGuard.stats().writesInFlight).toBe(0);
  });

  test("معاملة فشلت تُنقِص العدّاد كذلك — فلا يُقفَل الإتلاف إلى الأبد", async () => {
    const { sql, dbGuard } = await import("@/lib/db");

    await expect(
      sql.begin(async () => {
        throw new Error("فشل منطقي داخل المعاملة");
      })
    ).rejects.toThrow("فشل منطقي");

    expect(dbGuard.stats().writesInFlight).toBe(0);
  });
});
