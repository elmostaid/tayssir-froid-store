import { describe, expect, test, vi } from "vitest";
import { ADMIN_MAX_CONCURRENT_QUERIES, inBatches, loadSection } from "@/lib/admin/sectionData";
import { ServiceUnavailableError } from "@/lib/serviceUnavailable";

/**
 * هذان هما شرطا إصلاح 2026-09-21، مقيسَين لا موصوفَين: ألّا يتجاوز التزامن
 * ثلاثة مهما كثرت الاستعلامات، وألّا يتحوّل فشلٌ إلى قيمة تُقرأ كأنها بيانات.
 */
describe("inBatches — سقف التزامن", () => {
  test("لا يتجاوز عدد المهام الجارية في أي لحظة الحدّ المعلن", async () => {
    let running = 0;
    let peak = 0;
    const task = () => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return "ok";
    };

    await inBatches([task(), task(), task(), task(), task(), task(), task(), task()] as const);

    expect(peak).toBeLessThanOrEqual(ADMIN_MAX_CONCURRENT_QUERIES);
    expect(ADMIN_MAX_CONCURRENT_QUERIES).toBe(3);
  });

  test("يحفظ ترتيب النتائج كما لو كانت Promise.all", async () => {
    const slowFirst = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "أول";
    };
    const results = await inBatches([
      () => slowFirst(),
      async () => "ثانٍ",
      async () => "ثالث",
      async () => "رابع",
    ] as const);

    expect(results).toEqual(["أول", "ثانٍ", "ثالث", "رابع"]);
  });

  test("فشل مهمة داخل دفعة يُرمى كما هو — inBatches لا تبتلع شيئاً بنفسها", async () => {
    await expect(
      inBatches([
        async () => "ok",
        async () => {
          throw new Error("تعذّر");
        },
      ] as const)
    ).rejects.toThrow("تعذّر");
  });
});

describe("loadSection — تعذُّر مُعلَن، لا قيمة احتياطية", () => {
  test("النجاح يعود بالقيمة نفسها", async () => {
    await expect(loadSection(async () => 42, "test.ok")).resolves.toEqual({ ok: true, value: 42 });
  });

  test("الفشل يعود بـ ok:false بلا أي قيمة — لا صفر ولا قائمة فارغة", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await loadSection(async () => {
      throw new Error("connect timeout");
    }, "test.fail");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    consoleError.mockRestore();
  });

  test("يلتقط حتى ServiceUnavailableError التي تعيد safeQuery رميها", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await loadSection(async () => {
      throw new ServiceUnavailableError("db down");
    }, "test.serviceUnavailable");

    expect(result.ok).toBe(false);
    consoleError.mockRestore();
  });
});
