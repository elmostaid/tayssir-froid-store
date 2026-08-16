import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// اختبارات السبب الجذري لانهيار الموقع تحت الضغط: الاستعلام الذي يتجاوز
// المهلة يجب أن يُلغى فعلياً (query.cancel من postgres.js) لا أن يُترك
// معلَّقاً. استعلام متروك = اتصال محجوز للأبد في مجمّع postgres.js، وبعد
// max استعلامات متروكة تموت نسخة الخادم كاملة وهي لا تزال تستقبل الزبناء.
//
// نُحاكي هنا كائن Query الخاص بpostgres.js بأمانة: صنف يرث Promise، له
// cancel()، وthen() الذي يُشغِّل الاستعلام عند أول استدعاء (handle()).

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

class FakeQuery<T> extends Promise<T> {
  cancelled = false;
  handled = false;
  resolveWith!: (value: T) => void;
  rejectWith!: (reason: unknown) => void;

  static get [Symbol.species]() {
    return Promise;
  }

  static create<V>(): FakeQuery<V> {
    let resolveWith!: (value: V) => void;
    let rejectWith!: (reason: unknown) => void;
    const q = new FakeQuery<V>((res, rej) => {
      resolveWith = res as (value: V) => void;
      rejectWith = rej;
    });
    q.resolveWith = resolveWith;
    q.rejectWith = rejectWith;
    return q;
  }

  cancel() {
    this.cancelled = true;
    // postgres.js يرفض الوعد فعلياً عند الإلغاء (خطأ 57014) — وهذا بالضبط
    // ما يُحرِّر الاتصال ويُعيده للمجمّع.
    this.rejectWith(new Error("canceling statement due to user request"));
  }

  then(...args: unknown[]) {
    this.handled = true;
    return (Promise.prototype.then as (...a: unknown[]) => unknown).apply(
      this,
      args
    ) as never;
  }
}

let lastQuery: FakeQuery<unknown> | undefined;

vi.mock("postgres", () => {
  const client = () => {
    const q = FakeQuery.create<unknown>();
    lastQuery = q;
    return q;
  };
  return { default: () => client };
});

beforeEach(() => {
  vi.useFakeTimers();
  lastQuery = undefined;
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe("db.ts — إلغاء حقيقي للاستعلام عند تجاوز المهلة", () => {
  test("استعلام يتجاوز المهلة يُلغى فعلياً ويُرفض وعده (فيتحرّر الاتصال)", async () => {
    const { sql } = await import("@/lib/db");

    const pending = sql`select 1`;
    const settled = (pending as unknown as Promise<unknown>).then(
      () => "resolved",
      (e: Error) => `rejected: ${e.message}`
    );

    expect(lastQuery?.cancelled).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(lastQuery?.cancelled).toBe(true);
    await expect(settled).resolves.toMatch(/rejected: canceling statement/);
  });

  test("استعلام ينتهي قبل المهلة لا يُلغى أبداً، والمؤقّت يُنظَّف", async () => {
    const { sql } = await import("@/lib/db");

    const pending = sql`select 1`;
    const settled = (pending as unknown as Promise<unknown>).then((v) => v);

    lastQuery?.resolveWith([{ ok: true }]);
    await expect(settled).resolves.toEqual([{ ok: true }]);

    // بعد الانتهاء بنجاح، مرور وقت المهلة يجب ألا يُلغي أي شيء.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lastQuery?.cancelled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("أجزاء الاستعلام (fragments) لا تُسلَّح ولا تُنفَّذ كاستعلامات مستقلة", async () => {
    const { sql } = await import("@/lib/db");

    // مثل sql`order by sale_price asc` في catalog.ts — يُبنى ثم يُدمج داخل
    // استعلام آخر، ولا يُنتظَر أبداً. لا يجوز أن يُشغَّل أو يبدأ أي مؤقّت.
    const fragment = sql`order by sale_price asc`;

    expect((fragment as unknown as FakeQuery<unknown>).handled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect((fragment as unknown as FakeQuery<unknown>).cancelled).toBe(false);
  });

  test("المهلة تُسلَّح عند catch() أيضاً وليس then() فقط", async () => {
    const { sql } = await import("@/lib/db");

    const pending = sql`select 1`;
    const caught = (pending as unknown as Promise<unknown>).catch(
      (e: Error) => `caught: ${e.message}`
    );

    await vi.advanceTimersByTimeAsync(10_000);

    expect(lastQuery?.cancelled).toBe(true);
    await expect(caught).resolves.toMatch(/caught: canceling statement/);
  });
});

describe("safeQuery + إلغاء db.ts معاً", () => {
  test("الإلغاء يقع قبل مهلة safeQuery، فتُرجع القيمة الاحتياطية بلا استعلام متروك", async () => {
    const { sql } = await import("@/lib/db");
    const { safeQuery } = await import("@/lib/safeQuery");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = safeQuery(
      () => sql`select 1` as unknown as Promise<string[]>,
      ["fallback"],
      "test.context"
    );

    // عند 10 ثوان يقع إلغاء db.ts — قبل مهلة safeQuery (15 ثانية) بكثير.
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual(["fallback"]);
    expect(lastQuery?.cancelled).toBe(true);
    // لا مؤقّتات معلَّقة: لا مؤقّت db.ts ولا مؤقّت safeQuery.
    expect(vi.getTimerCount()).toBe(0);
    errorSpy.mockRestore();
  });
});
