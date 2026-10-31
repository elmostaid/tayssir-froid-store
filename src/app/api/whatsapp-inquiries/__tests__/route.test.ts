import { describe, expect, test, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, reference: "Q-0000000000", isNew: true })));
vi.mock("@/lib/orders/createWhatsappInquiry", () => ({ createWhatsappInquiry: createMock }));
vi.mock("@/lib/orders/requestContext", () => ({
  readOrderRequestContext: async () => ({ clientIpAddress: "203.0.113.9", adConsent: "unknown" }),
}));

const { POST } = await import("@/app/api/whatsapp-inquiries/route");

function request(body: unknown) {
  return new Request("http://localhost/api/whatsapp-inquiries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/whatsapp-inquiries", () => {
  test("جسم غير JSON: 400 بلا تسجيل", async () => {
    const response = await POST(new Request("http://localhost/x", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("سكربت يُغرق المسار من نفس الـIP: يُوقَف بعد 30 في ربع ساعة", async () => {
    createMock.mockClear();
    const statuses: number[] = [];
    for (let i = 0; i < 32; i += 1) {
      statuses.push((await POST(request({ idempotencyKey: crypto.randomUUID(), kind: "general" }))).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
    expect(createMock).toHaveBeenCalledTimes(30);
  });
});
