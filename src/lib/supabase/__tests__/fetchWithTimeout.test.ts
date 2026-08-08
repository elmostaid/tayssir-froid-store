import { describe, expect, test, vi } from "vitest";
import { createTimeoutFetch } from "../fetchWithTimeout";

// يحاكي هذا خدمة Supabase Auth المتعطّلة: fetch لا يُنهي أبداً من تلقاء
// نفسه (تماماً كطلب HTTP الحقيقي العالق الذي أظهرته Vercel Runtime Logs).
// الاختبار يتأكد أن createTimeoutFetch يُلغي هذا الطلب فعلياً خلال المهلة
// المضبوطة، بدل الانتظار له إلى الأبد.
describe("createTimeoutFetch", () => {
  test("يُلغي طلباً عالقاً خلال المهلة المضبوطة، ولا ينتظره للأبد", async () => {
    let capturedSignal: AbortSignal | undefined;
    // fetch الحقيقي يرفض الوعد بـAbortError عند إطلاق إشارة الإلغاء — هذا
    // بالضبط ما نتحقق منه هنا (وليس فقط أن الإشارة أُطلقت).
    const hangingFetch = vi.fn((_input: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", hangingFetch);

    const timeoutFetch = createTimeoutFetch(30);
    const result = timeoutFetch("https://example.test/auth/v1/user", {});

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(capturedSignal?.aborted).toBe(true);

    vi.unstubAllGlobals();
  });

  test("لا يُلغي طلباً ينتهي بسرعة قبل المهلة", async () => {
    const fastFetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", fastFetch);

    const timeoutFetch = createTimeoutFetch(5000);
    const response = await timeoutFetch("https://example.test/auth/v1/user", {});

    expect(response.status).toBe(200);

    vi.unstubAllGlobals();
  });
});
