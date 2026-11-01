import { afterEach, describe, expect, test, vi } from "vitest";

const sendCapiEvent = vi.fn();
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: (...a: unknown[]) => sendCapiEvent(...a) }));

import { POST } from "../route";

const TOKEN = "t".repeat(40);
const req = (body: unknown, auth = `Bearer ${TOKEN}`) =>
  new Request("http://x/api/meta-test-purchase", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

afterEach(() => { vi.unstubAllEnvs(); sendCapiEvent.mockReset(); });

describe("أداة اختبار Meta: لا حدث حقيقي أبداً", () => {
  test("مطفأة بلا رمز بيئة ⇒ 404 ولا إرسال", async () => {
    const res = await POST(req({ testEventCode: "TEST123" }));
    expect(res.status).toBe(404);
    expect(sendCapiEvent).not.toHaveBeenCalled();
  });

  test("رمز تفويض خاطئ ⇒ 401 ولا إرسال", async () => {
    vi.stubEnv("META_TEST_TRIGGER_TOKEN", TOKEN);
    const res = await POST(req({ testEventCode: "TEST123" }, "Bearer wrong"));
    expect(res.status).toBe(401);
    expect(sendCapiEvent).not.toHaveBeenCalled();
  });

  test.each([undefined, "", "abc", "LIVE123"])("بلا رمز Test Events صالح (%s) ⇒ 400 ولا إرسال", async (code) => {
    vi.stubEnv("META_TEST_TRIGGER_TOKEN", TOKEN);
    const res = await POST(req({ testEventCode: code }));
    expect(res.status).toBe(400);
    expect(sendCapiEvent).not.toHaveBeenCalled();
  });

  test("بيعة واتساب اصطناعية بقناة chat ورمز الاختبار دائماً", async () => {
    vi.stubEnv("META_TEST_TRIGGER_TOKEN", TOKEN);
    sendCapiEvent.mockResolvedValue({ ok: true, status: 200, eventsReceived: 1 });
    const res = await POST(req({ testEventCode: "test4821" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, eventsReceived: 1, actionSource: "chat" });
    const call = sendCapiEvent.mock.calls[0][0];
    expect(call).toMatchObject({ eventName: "Purchase", actionSource: "chat", testEventCode: "TEST4821" });
    expect(call.eventId).toMatch(/^test-purchase:/);
    expect(call.userData.phone).toBe("212600000000");
    expect(call.eventSourceUrl).toBeUndefined();
  });
});
